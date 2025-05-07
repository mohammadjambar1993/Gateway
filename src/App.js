import { Helmet, HelmetProvider } from 'react-helmet-async';

import { APP_VERSION } from './constants/config'

// import logo from './logo.svg';
import './App.css';

import Router from "./router/router";
import { BleProvider } from "./contexts/BleContext";

import NotificationRender from "./components/notification/NotificationRender";

function App() {
  return (
    <HelmetProvider>
      <NotificationRender>
        <Helmet>
          <title>PodHub { APP_VERSION }</title>
        </Helmet>
        <BleProvider>
          <Router />
        </BleProvider>
      </NotificationRender>
    </HelmetProvider>
  );
}

export default App;
