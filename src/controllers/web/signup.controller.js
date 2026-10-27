const signupController = {
    getSignup: (req, res)=>{
        res.render('signup', { title:"Signup" })
    },
    postSignup: (req, res)=>{
        res.render('signup', { title:"Signup" })
    }
}

export default signupController