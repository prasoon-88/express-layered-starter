import homeController from '#controllers/web/home.controller.js'
import { Router } from 'express'

const homeRouter = Router()

homeRouter.get('/', homeController.getHome)

export default homeRouter