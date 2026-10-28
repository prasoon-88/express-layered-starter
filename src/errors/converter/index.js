import httpConverter from './http.converter.js'
import jwtConverter from './jwt.converter.js'
import mongooseConverter from './mongoose.converter.js'

const converters = [httpConverter, mongooseConverter, jwtConverter]

export const convertError = (err) =>{
    for(const converter of converters){
        try{
            const converted = converter(err)
            if(converted) return converted
        }catch(error){
            console.log('[ FAILED ]: Error converter')
        }
    }

    return null
}
