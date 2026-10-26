import { Router, urlencoded } from "express";
import homeRouter from "./home.routes.js";

const WEB_ROUTER = Router()

WEB_ROUTER.use(urlencoded({ extended:false }))

WEB_ROUTER.use('/', homeRouter)

export default WEB_ROUTER