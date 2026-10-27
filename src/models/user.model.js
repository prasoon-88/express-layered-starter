import mongoose from 'mongoose'
import { randomBytes, createHmac } from 'crypto'
import USER_CONSTANTS from '#constants/user.constant.js'

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    avatar:{
        type: String,
        default: '/images/default_avatar.png'
    },
    role:{
        type: String,
        enum: USER_CONSTANTS.USER_ROLES,
        default: USER_CONSTANTS.USER_ROLES.at(0)
    },  
    salt:{
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true,
    },
},{
    timestamps: true
})

// Mongoose Middleware
userSchema.pre('save', function(next){
    const user = this;

    if(!user.isModified('password')) return 

    const salt = randomBytes(16).toString()
    const hashedPassword = createHmac('sha256', salt)
                            .update(this.password)
                            .digest('hex')
    
    this.password = hashedPassword
    this.salt = salt
    
    next()
})

const User = mongoose.model('user', userSchema)

export default User