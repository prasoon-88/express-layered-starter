import helmet from 'helmet';
import { CSP_DIRECTIVES } from '#constants/http/contentSecurityPolicy.constant';

const securityHeadersMiddleware = () =>
  helmet({
    contentSecurityPolicy: { useDefaults: true, directives: CSP_DIRECTIVES },
  });

export default securityHeadersMiddleware;
