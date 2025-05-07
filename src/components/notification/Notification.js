import React from 'react';
import styled from 'styled-components/macro';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const Container = styled.div`
  .Toastify__toast {
    border-radius: 4px;
    font-family: inherit;
  }
`;

const Notification = () => {
  return (
    <Container>
      <ToastContainer />
    </Container>
  );
};

export default Notification;
