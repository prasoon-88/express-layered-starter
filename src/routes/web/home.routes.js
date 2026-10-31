import { Router } from 'express';
import homeController from '#controllers/web/home.controller.js';

const homeRouter = Router();

homeRouter.get('/', homeController.getHome);

export default homeRouter;
