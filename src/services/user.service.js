import userRepository from "#repository/user.repository.js"

const REGISTER_REQUIRED_FIELDS = ['fullName','email','password']
const registerUser = async(data) => {
    const { fullName, email, password, avatar } = data
    const missing = REGISTER_REQUIRED_FIELDS.filter((field)=>!data[field])
    
    if(missing.length) return
    
}

const userService = {
    registerUser  
}

export default userService