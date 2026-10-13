/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerBackgroundHandlers } from './src/app/bootstrap';

// Doit précéder registerComponent : la tâche SMS Headless peut démarrer app fermée.
registerBackgroundHandlers();

AppRegistry.registerComponent(appName, () => App);
