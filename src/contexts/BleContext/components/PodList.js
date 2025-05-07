import React, {
  useContext,
  // useState
} from "react";

import Card from 'react-bootstrap/Card';
import ListGroup from 'react-bootstrap/ListGroup';
import Button from 'react-bootstrap/Button';
import PodListItem from './PodListItem'

import { BleContext } from "../index";

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner } from '@fortawesome/free-solid-svg-icons'


export default function PodList({ title, subtitle, list, enableGlobalStartButton=false, enableScanButton=false }) {

  const {
    // connectionStatus,
    startScan,
    isScanning,
    connectPod,
    disconnectPod,
    lastScan,
    isRecordingGlobal,
    startGlobalPods,
    startPod,
    stopPod,
    openGraphModal,
    openEncryptionModal,
  } = useContext(BleContext);

  return (<Card className="w-100 mb-5">
    <Card.Body>
      <Card.Title>
        {title}
        {enableGlobalStartButton && <Button
          onClick={() => !isRecordingGlobal && startGlobalPods()}
          disabled={isRecordingGlobal}
          className="float-end"
          size="sm"
          variant="primary"
        >
          {isRecordingGlobal && (<FontAwesomeIcon className="me-2" icon={faSpinner} spin />)}
          Universal: Start Recording
        </Button>}

        {enableScanButton && <Button
          onClick={() => !isScanning && startScan()}
          disabled={isScanning}
          className="float-end"
          size="sm"
          variant="primary"
        >
          {isScanning && (<FontAwesomeIcon className="me-2" icon={faSpinner} spin />)}
          Scan
        </Button>}
      </Card.Title>

      <Card.Subtitle>
        {subtitle}<br />
        {enableScanButton && (<small className="fw-normal">Last search : {!lastScan ? 'never' : new Date(lastScan).toString() }</small>)}
      </Card.Subtitle>
    </Card.Body>
    { Object.keys(list).length === 0 ? (<ListGroup variant="flush">
        <ListGroup.Item key="connected_notfound" as="li" className="d-flex justify-content-between align-items-start">
          No connected pod found! Scan to look for pods to connect to.
        </ListGroup.Item>
      </ListGroup>) : (
      <ListGroup variant="flush">
        {Object.keys(list).map((podId) => <ListGroup.Item className="" key={podId}>

          <PodListItem
            item={list[podId]}
            disconnectPod={disconnectPod}
            connectPod={connectPod}
            openEncryptionModal={openEncryptionModal}
            openGraphModal={openGraphModal}
            stopPod={stopPod}
            startPod={startPod}
            mini={enableScanButton}
          />

        </ListGroup.Item>)}
      </ListGroup>
    )}
  </Card>)
}
