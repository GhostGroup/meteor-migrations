import { Logger } from 'meteor/ostrio:logger';
import { LoggerConsole } from 'meteor/ostrio:loggerconsole';

const Log = new Logger();
// Initialize and enable LoggerConsole with default settings:
(new LoggerConsole(Log)).enable();

export default Log;
