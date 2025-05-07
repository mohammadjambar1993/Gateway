import React, { createContext } from 'react';
import { toast } from 'react-toastify';
import NotificationContainer from '../components/notification/NotificationContainer';

export const NotificationContext = createContext();

export const STATUSES = {
  DEFAULT: toast.TYPE.DEFAULT,
  SUCCESS: toast.TYPE.SUCCESS,
  WARNING: toast.TYPE.WARNING,
  DARK: toast.TYPE.DARK,
  ERROR: toast.TYPE.ERROR,
  INFO: toast.TYPE.INFO
};

export const NotificationProvider = ({ children }) => {
  const showNotification = ({
    title = '',
    message = '',
    autoClose = true,
    position = 'bottom-right',
    type = STATUSES.SUCCESS,
    style = undefined,
    progressStyle = undefined,
    hideProgressBar = false,
    pauseOnHover = true,
    pauseOnFocusLoss = undefined,
    closeOnClick = true,
    draggable = undefined,
    delay = undefined,
    closeButton = undefined,
    onClick = undefined,
    onOpen = undefined,
    onClose = undefined
  }) => {
    return toast(<NotificationContainer enableMultiContainer limit={3} message={message} type={type} title={title} />, {
      title,
      message,
      autoClose,
      position,
      style,
      type,
      progressStyle,
      hideProgressBar,
      pauseOnHover,
      pauseOnFocusLoss,
      draggable,
      delay,
      closeButton,
      closeOnClick,
      onClick,
      onOpen,
      onClose
    });
  };

  return (
    <NotificationContext.Provider
      value={{
        STATUSES,
        showNotification
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const NotificationConsumer = NotificationContext.Consumer;
