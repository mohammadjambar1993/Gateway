import { Typeahead, Highlighter } from 'react-bootstrap-typeahead'; // ES2015

import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Alert from 'react-bootstrap/Alert';


export const EncryptionModal = ({show, onHide, podIdentifier, error, onValueChange, keyValue, digitValue, onSave, choices, adminMode=false }) => {


  const _onValueChange = (values) => {
    onValueChange(values)
  }

  const _maskValue = (key) => {
    return '*'.repeat(key.length);
  }

  return (<Modal show={show} onHide={onHide}>
    <Modal.Header closeButton>
      <Modal.Title>Encryption Keys {podIdentifier || ''}</Modal.Title>
    </Modal.Header>
    <Modal.Body>

      { error && (<Alert variant={'danger'}>
        {error}
      </Alert>)}

      <Form>
        <Form.Group className="mb-3" controlId="formKey">
          <Form.Label>Encryption Key</Form.Label>
          <Form.Control
            onChange={(event) => {
              _onValueChange({key: event.target.value})
            }}
            value={adminMode?keyValue:_maskValue(keyValue)}
            type="text"
            placeholder="Key..."
          />
        </Form.Group>

        <Form.Group className="mb-3" controlId="formDigit">
          <Form.Label>Encryption Digit</Form.Label>
          <Form.Control
            onChange={(event) => {
              _onValueChange({digit: event.target.value})
            }}
            value={adminMode?digitValue:_maskValue(digitValue)}
            type="text"
            placeholder="Digit..."
          />
        </Form.Group>

        {choices.length > 0 && (<>
          <h5 className="text-divider">
            <span>Or select a previously saved pair</span>
          </h5>

          <Typeahead
            id="enc-autocomplete"
            renderMenuItemChildren={(option, { text }) => (
              <>
                <Highlighter search={text}>{`Pod Serial Number: ${option.serialNumber}`}</Highlighter>
                <div>
                  <small>Key: {adminMode?option.key:_maskValue(option.key)} - Digit: {adminMode?option.digit:_maskValue(option.key)}</small>
                </div>
              </>
            )}
            labelKey={option => `${option.serialNumber} ${adminMode?option.key:_maskValue(option.key)} ${adminMode?option.digit:_maskValue(option.key)}`}
            options={choices}
            placeholder="Choose a pair..."
            onChange={(selected) => {
              _onValueChange({
                key: selected[0].key,
                digit: selected[0].digit,
              })
            }}
            onInputChange={(text, event) => {
              // console.log('change event', {text, event})
            }}
          />
        </>)}

      </Form>

    </Modal.Body>
    <Modal.Footer>
      <Button variant="primary" type="submit" onClick={onSave}>
        Submit
      </Button>
    </Modal.Footer>
  </Modal>)
}


