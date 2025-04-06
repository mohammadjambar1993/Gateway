import { Typeahead, Highlighter } from 'react-bootstrap-typeahead'; // ES2015

import Modal from 'react-bootstrap/Modal';
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Alert from 'react-bootstrap/Alert';


export const EncryptionModal = ({show, onHide, podIdentifier, error, onValueChange, keyValue, digitValue, onSave, choices }) => {


  const _onValueChange = (values) => {
    onValueChange(values)
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
            value={keyValue}
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
            value={digitValue}
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
                  <small>Key: {option.key} - Digit: {option.digit}</small>
                </div>
              </>
            )}
            labelKey={option => `${option.serialNumber} ${option.key} ${option.digit}`}
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


