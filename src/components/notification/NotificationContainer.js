import React from 'react';
// import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
// import { faPlus } from '@fortawesome/free-solid-svg-icons'
// import { ErrorCircledIcon, WarningCircleIcon, CheckedCircleIcon } from '../../assets/icons';

import NotificationContent from './NotificationContent';

const NotificationContainer = ({ type, message, title }) => {
  switch (type) {
    case 'default':
      return <NotificationContent message={message} type={type} title={title} />;
    case 'success':
      return <NotificationContent message={message} type={type} title={title} />;
    case 'warning':
      return <NotificationContent message={message} type={type} title={title} />;
    case 'dark':
      return <NotificationContent message={message} type={type} title={title} />;
    case 'error':
      return <NotificationContent message={message} type={type} title={title} />;
    case 'info':
      return <NotificationContent message={message} type={type} title={title} />;
    default:
      return <NotificationContent message={message} type={type} title={title} />;
  }
};

export default NotificationContainer;
