import helmet from 'helmet';
import { CSP_DIRECTIVES } from '#constants/http/contentSecurityPolicy.constant';

export const createSecurityHeadersMiddleware = () =>
  helmet({
    contentSecurityPolicy: { useDefaults: true, directives: CSP_DIRECTIVES },
  });
