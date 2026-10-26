const homeController = {
    getHome: (req, res)=>{
        res.render('home', { title:"Home" })
    }
}

export default homeController