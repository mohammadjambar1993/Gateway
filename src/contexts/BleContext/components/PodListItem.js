import Badge from 'react-bootstrap/Badge';
import ProgressBar from 'react-bootstrap/ProgressBar';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSync, faCircleExclamation } from '@fortawesome/free-solid-svg-icons'


// as per https://infocenter.nordicsemi.com/pdf/nRF52840_PS_v1.1.pdf
// chapter 6.20.15.9, rssi range is -90 to -20. assuming values closer
// to 0 are more accurate
const rssiRange = {
  min: -90,
  max: -20,
}

const getPercentage = (startpos, endpos, currentpos) => {
  const distance = endpos - startpos;
  const displacement = currentpos - startpos;
  return (displacement / distance) * 100;
};

const getRSSIProgressBarVal = (rssi) => {
  const percent = getPercentage(rssiRange.min, rssiRange.max, rssi)
  const variant = percent <= 20 ? 'danger' : percent <= 50 ? 'warning' : 'success' 

  return {
    label: `rssi: ${rssi}`,
    now: percent,
    variant,
  }
}

export default function PodList({ item, connectPod, disconnectPod, openEncryptionModal, openGraphModal, stopPod, startPod, mini }) {


  return (<>
    <div className="d-flex justify-content-between align-items-start">
      <div className="ms-2 me-auto">
        <div className="fw-bold">
          {item.advertisement.localName} 
          {!mini && (<> { item.settings.test && <Badge as="sup"  bg="info">Test Mode</Badge> } { item.metadata && item.metadata.encryptionRequired && (<Badge as="sup" bg={item.metadata.encryptionEnabled ? 'success' : 'warning'}>{item.metadata.encryptionEnabled ? 'Encryption Enabled' : 'Encryption Keys Required'}</Badge>) }
          </>)}
        </div>
        <div className="small">id: {item.id} - State: {item.state}</div>
        
        { item.metadata &&
          (<>{!mini && (<div className="small">
            Battery: {item.metadata.batteryLevel || '-'} - 
            Firmware Version: {item.metadata.firmwareVersion || '-'} - 
            Hardware Version: {item.metadata.hardwareVersion || '-'}
          </div>)}
          <div className="small">
            Serial Number: {item.metadata.serialNumber ? `0${item.metadata.serialNumber}` : 'unavailable'}
            {!mini && item.metadata.garmentId && <> Garment: {(item.metadata.garmentOptions.find((opt) => opt.code === item.metadata.garmentId)).name } ({item.metadata.garmentId})</>}
          </div></>)
        }
      </div>

      <div className="float-end">
        <div className="mb-1">
          <ProgressBar
            variant={getRSSIProgressBarVal(item.rssi).variant}
            now={getRSSIProgressBarVal(item.rssi).now}
            label={getRSSIProgressBarVal(item.rssi).label}
          />
        </div>
        <Button
          onClick={() => {
            if (item.state === 'disconnected')
              connectPod(item.id)
            else if (item.state === 'connected')
              disconnectPod(item.id)
          }}
          className="float-end"
          size="sm"
          disabled={item.state !== 'disconnected' && item.state !== 'connected' }
          variant={item.state === 'disconnected' ? 'primary' : item.state === 'connected' ? 'danger' : 'secondary'}
        >{item.state === 'disconnected' ? 'Connect' : item.state === 'connected' ? 'Disconnect' : item.state}</Button>

      </div>

    </div>
    { !mini && item.state === 'connected' && <div className="mt-2">
      <ButtonToolbar aria-label="Toolbar with button groups">
        {item.metadata.encryptionRequired && !item.metadata.encryptionEnabled ? (<>
            <ButtonGroup size="sm" className="me-2" aria-label="Encryption key controls">

                <Button
                  variant="warning"
                  onClick={() => {
                    openEncryptionModal({peripheralId: item.id})
                  }}
                >
                  <FontAwesomeIcon className="me-2" icon={faCircleExclamation} /> Pod Encryption key pair is required
                </Button>
            </ButtonGroup>
          </>) : (<>
            <ButtonGroup size="sm" className="me-2" aria-label="Primary controls">
              { item.isSaving ?
                <Button onClick={() => stopPod(item.id)}><FontAwesomeIcon className="me-2" icon={faSync} spin /> Stop Recording Data</Button> :
                <Button onClick={() => startPod(item.id)}>Start Recording Data</Button>
              }
            </ButtonGroup>
            <ButtonGroup size="sm" className="me-2" aria-label="Misc controls">
              {false && item.metadata.encryptionRequired && (<Button
                  disabled={item.isSaving}
                  variant="info"
                  onClick={() => {
                    if (item.isSaving) return;
                    openEncryptionModal({peripheralId: item.id})
                  }}
                >
                  Update Encryption Key
                </Button>)}
              { item.isSaving && <Button onClick={() => openGraphModal(item.id)}>Graph</Button> }
            </ButtonGroup>
          </>) }
      </ButtonToolbar>
    </div> }
    { /* item.isSaving &&
      (<>
        <hr />
        <div className="mt-2">
          <div className="fw-bold">Active Characteristics</div>
          <ListGroup className="w-50 overflow-auto" style={{ height: '200px' }}>
            {Object.keys(item.activeNotifications).map((sig) => (
              <ListGroup.Item
                as="li"
                key={sig}
                className="d-flex justify-content-between align-items-start"
              >
                <div className="ms-2 me-auto">
                  <div className="fw-bold">{item.activeNotifications[sig].charId.substr(4, 4)}</div>
                  Status: {item.activeNotifications[sig].active ? 'active' : 'inactive' }
                </div>
                <Badge bg="primary" pill>
                  {item.activeNotifications[sig].count}
                </Badge>
              </ListGroup.Item>
            ))}
          </ListGroup>
        </div>
      </>)
    */ }

    { !mini && item.settings && item.settings.csvFileName &&
      (<>
        <hr />
        <div className="mt-2">
          <div className="fw-bold">Settings</div>
          <div className="small">
            Filename: {item.settings.csvFileName || '-'} - 
            Files Saved: ({item.settings.filesSaved || '0'} / 
            { item.settings.saveNumber === false ? <> &infin;</> : item.settings.saveNumber }) - 

            Participant Id: {item.settings.partId || '-'} - 
            Save Interval: {(item.settings.saveInterval ? (item.settings.saveInterval /1000) + 's' : '-')} - 
            Task Name: {item.settings.taskName || '-'}
          </div>
        </div>
      </>)
    }
  </>)
}
