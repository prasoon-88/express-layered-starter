import express from 'express';
import PATHS from '#constants/path.constant.js';
import ROUTES from '#routes/index.js';
import notFoundMiddleware from '#middlewares/notFound.middleware.js';
import errorHandlerMiddleware from '#middlewares/error.middleware.js';
import requestIdMiddleware from '#middlewares/requestId.middleware.js';
import httpLoggerMiddleware from '#middlewares/httpLogger.middleware.js';
import helmet from 'helmet';
import ENV_CONSTANTS from '#constants/env.constant.js';

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
