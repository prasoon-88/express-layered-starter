import express from 'express';
import PATHS from '#constants/path.constant';
import ROUTES from '#routes/index';
import notFoundMiddleware from '#middlewares/notFound.middleware';
import errorHandlerMiddleware from '#middlewares/error.middleware';
import requestIdMiddleware from '#middlewares/requestId.middleware';
import httpLoggerMiddleware from '#middlewares/httpLogger.middleware';
import helmet from 'helmet';
import ENV_CONSTANTS from '#constants/env/index';

const app = express();

// Application settings config
app.set('trust proxy', ENV_CONSTANTS.TRUST_PROXY);
app.set('view engine', 'ejs');
app.set('views', PATHS.VIEWS.path);

// Pre Middlewares
app.use(helmet());
app.use(requestIdMiddleware());
app.use(httpLoggerMiddleware());
app.use(express.static(PATHS.PUBLIC.path));

// Routes
app.use('/', ROUTES);

// Post Middlewares
app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

export default app;
