import { parseEnv } from './schema.ts';

const ENV_CONSTANTS = Object.freeze(parseEnv(process.env));

export default ENV_CONSTANTS;
