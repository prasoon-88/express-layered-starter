import { Router, urlencoded } from 'express';
import homeRouter from './home.routes.js';
import signupRouter from './signup.routes.js';

const WEB_ROUTER = Router();

WEB_ROUTER.use(urlencoded({ extended: false }));

WEB_ROUTER.use('/', homeRouter);
WEB_ROUTER.use('/signup', signupRouter);

export default WEB_ROUTER;
