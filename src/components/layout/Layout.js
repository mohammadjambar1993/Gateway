import React from "react";

import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

import {
  APP_VERSION
} from '../../constants/config'

// import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
// import { faVolumeHigh, faVolumeXmark, faMoon } from '@fortawesome/free-solid-svg-icons'
// import { faSun } from '@fortawesome/free-regular-svg-icons'


const Layout = ({ children }) => {
  return (
    <Container fluid className="p-4 mb-5 pb-3">
      <Row className="pb-5">
        <Col xs={true}>
          PodHub {APP_VERSION}
        </Col>
      </Row>

      {children}
    </Container>
    
  );
};

export default Layout;