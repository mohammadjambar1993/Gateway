import React, {
  useState,
  createContext,
  useEffect,
  useRef,
  useContext,
} from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
// import styled from "styled-components";

import prettyBytes from "pretty-bytes";

import {
  BLE_WS,
  // APP_VERSION,
} from "../../constants/config";
import Modal from "react-bootstrap/Modal";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Navbar from "react-bootstrap/Navbar";
import Container from "react-bootstrap/Container";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import Popover from "react-bootstrap/Popover";
import Alert from "react-bootstrap/Alert";
import ListGroup from "react-bootstrap/ListGroup";
import Card from "react-bootstrap/Card";

import { GraphModal } from "./components/GraphModal";
import { EncryptionModal } from "./components/EncryptionModal";
// import { AppInfoPopOver } from './components/AppInfoPopOver'
import { NotificationContext, STATUSES } from "../NotificationContext";

import AppLogo from "../../logo.svg";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircle } from "@fortawesome/free-solid-svg-icons";
import { GraphModalImu } from "./components/GraphModalImu";

export const BleContext = createContext();

const defaultSettings = {
  saveInterval: "30",
  saveNumber: "1",
  csvFileName: "podLog",
  taskName: "activity",
  partId: "unknown",
  test: false,
};

const settingsValidation = {
  saveInterval: /^\d{1,3}$/,
  saveNumber: /^\d+$/,
  csvFileName: /^[a-z0-9_-]+$/i,
  taskName: /^[a-z0-9_\-\s]+$/i,
  partId: /^[a-z0-9_-]+$/i,
  test: (val) => typeof val === "boolean",
};

const ENCRYPTION_MODAL_INIT_STATE = {
  visible: false,
  error: false,
  loading: false,
  key: "", // this is ONLY used for taking user input.
  digit: "",
  // list: [],
  selectedIdx: null,
  peripheralId: null,
};

const AppStatus = {
  UNKNOWN: "unknown",
  CONNECTING: "connecting",
  RUNNING: "running",
  SUSPENDED: "suspended",
  SYNCING: "syncing",
  ERROR: "error",
  DISCONNECTED: "disconnected",
};

export const BleProvider = (props) => {
  const [socketUrl /*, setSocketUrl */] = useState(BLE_WS);
  // const [messageHistory, setMessageHistory] = useState([]);
  const [isRecordingGlobal, setIsRecording] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState(0);
  const [connectedPods, setConnectedPods] = useState({});
  const [podList, setPodList] = useState({});

  const settingsPromptPromise = useRef(null);
  const [settingsPromptModalVisible, setSettingsPromptModalVisible] =
    useState(false);
  const [settingsFormValues, setSettingsFormValues] = useState(defaultSettings);

  const { showNotification } = useContext(NotificationContext);

  const [graphModalVisible, setGraphModalVisible] = useState(false);
  const [graphModalImuVisible, setGraphModaImuVisible] = useState(false);
  const [selectedGraphPod, setSelectedGraphPod] = useState("");
  const [graphData, setGraphData] = useState({});

  const [lastErrorMsg, setlastErrorMsg] = useState("");

  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(
    socketUrl,
    {
      share: true,
      shouldReconnect: (closeEvent) => true,
    }
  );

  const [debugInfo, setDebugInfo] = useState({
    enabled: false,
    data: {
      rss: 0,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
      diskspace: {
        diskPath: null,
        free: 0,
        size: 0,
      },
    },
  });

  const [appState, setAppState] = useState(AppStatus.DISCONNECTED);

  const [appSuspended, setAppSuspended] = useState({
    is: false,
    reason: null,
  });

  const [encryptionDB, setEncryptionDB] = useState([]);

  const [encryptionModal, setEncryptionModal] = useState(
    ENCRYPTION_MODAL_INIT_STATE
  );

  const [encryptionModalPending, setEncryptionModalPending] = useState([]);

  const connectionStatus = {
    [ReadyState.CONNECTING]: "Connecting",
    [ReadyState.OPEN]: "Connected",
    [ReadyState.CLOSING]: "Disconnecting",
    [ReadyState.CLOSED]: "Disconnected",
    [ReadyState.UNINSTANTIATED]: "Uninstantiated",
  }[readyState];

  const connectionStatusBackground = {
    [ReadyState.CONNECTING]: "secondary",
    [ReadyState.OPEN]: "success",
    [ReadyState.CLOSING]: "warning",
    [ReadyState.CLOSED]: "danger",
    [ReadyState.UNINSTANTIATED]: "secondary",
  }[readyState];

  const appStatus = {
    [AppStatus.UNKNOWN]: "status is unknown",
    [AppStatus.RUNNING]: "is running",
    [AppStatus.SUSPENDED]: "is suspended",
    [AppStatus.ERROR]: "has error(s)",
    [AppStatus.SYNCING]: "is syncing",
    [AppStatus.CONNECTING]: "is connecting",
    [AppStatus.DISCONNECTED]: "is disconnected",
  }[appState];

  const appStatusBackground = {
    [AppStatus.UNKNOWN]: "secondary",
    [AppStatus.RUNNING]: "success",
    [AppStatus.SUSPENDED]: "warning",
    [AppStatus.ERROR]: "danger",
    [AppStatus.SYNCING]: "primary",
    [AppStatus.CONNECTING]: "secondary",
    [AppStatus.DISCONNECTED]: "default",
  }[appState];

  useEffect(() => {
    // console.log('readyState', { readyState, state: ReadyState.OPEN })
    if (readyState === ReadyState.OPEN) {
    }

    switch (readyState) {
      case ReadyState.OPEN:
        setAppState(AppStatus.SYNCING);
        // we are connected, lets pull a snapshot
        sendJsonMessage({
          code: "ble:snapshot",
        });
        break;
      case ReadyState.CONNECTING:
        setAppState(AppStatus.CONNECTING);
        break;
      case ReadyState.CLOSED:
        setAppState(AppStatus.DISCONNECTED);
        break;
      default:
        setAppState(AppStatus.UNKNOWN);
    }
  }, [readyState, sendJsonMessage]);

  useEffect(() => {
    // we use processMsg since we use return val to control flow here and useEffect shouldnt have return
    const processMsg = () => {
      if (null !== lastJsonMessage) {
        console.log("new json msg received", lastJsonMessage);
        const { code, data, error } = lastJsonMessage;

        if (error) {
          console.error("processMsg", error);
          // more error handling ?
          setlastErrorMsg(error && error.message ? error.message : error);
          setAppState(AppStatus.ERROR);
        }

        // if (['ble:snapshot'].includes(code)) {
        //   // we get confirmation of our commands
        //   return true;
        // }

        const noError = !error;

        if ("ble:pod:notification" === code) {
          const { /*peripheralId,*/ notification } = data;
          // if (peripheralId) {
          //   notification.containerId = `toast_${peripheralId}`
          // }
          showNotification(notification);
          return;
        }

        if ("ble:snapshot" === code && noError) {
          if (data.state) {
            setIsScanning(data.state.isScanning);
            setLastScan(data.state.lastScan);
            setConnectedPods(data.state.connectedPods);
            setPodList(data.state.podList);

            setEncryptionDB(data.encdb);

            setAppState(AppStatus.RUNNING);

            setDebugInfo({
              enabled: true,
              data: data.state.debug,
            });

            showNotification({
              title: "Client Synced",
              message: `You have been synced to PodHub backend`,
              type: STATUSES.SUCCESS,
            });

            if (
              typeof data.state.suspended !== "undefined" &&
              typeof data.state.suspended.is !== "undefined"
            ) {
              setAppSuspended(data.state.suspended);
              if (data.state.suspended.is === true) {
                setAppState(AppStatus.SUSPENDED);
              } else {
                setAppState(AppStatus.RUNNING);
              }
            }

            // check if there are any pending encryption promises
            // const _connectedPods = data.state.connectedPods
            // console.log('_connectedPods', _connectedPods)
            // const peripheralIds = Object.keys(_connectedPods)
            // const matches = []
            // peripheralIds.forEach((id) => {
            //   if (_connectedPods[id]?.metadata?.encryptionRequired
            //     && !_connectedPods[id]?.metadata.encryptionEnabled) {
            //     matches.push(id)
            //   }
            // })

            // if (matches.length) {
            //   setEncryptionModalPending(matches)
            // }
          }
        }

        if ("ble:encdb:update" === code && noError) {
          setEncryptionDB(data);
        }

        if ("ble:state:update" === code && noError) {
          console.log("_podList", data);

          setIsScanning(data.isScanning);
          setLastScan(data.lastScan);
          setConnectedPods(data.connectedPods);
          setPodList(data.podList);

          setDebugInfo({
            enabled: true,
            data: data.debug,
          });

          if (
            typeof data.suspended !== "undefined" &&
            typeof data.suspended.is !== "undefined"
          ) {
            setAppSuspended(data.suspended);
            if (data.suspended.is === true) {
              setAppState(AppStatus.SUSPENDED);
            } else {
              setAppState(AppStatus.RUNNING);
            }
          }

          // data.suspended
          // data.debug

          // showNotification({
          //   title: 'Client Updated',
          //   message: `You have been synced to PodHub backend`,
          //   type: STATUSES.SUCCESS,
          // });
        }

        // if ('ble:debug:data' === code && noError) {
        //   console.log('ble:debug:data', data)
        //   setDebugInfo({
        //     enabled: debugInfo.enabled,
        //     data,
        //   })
        // }

        if ("ble:pod:stream:data" === code && noError) {
          // handle showing data
          // console.log('ble:pod:stream:start received data')

          if (data[selectedGraphPod]) {
            // console.log('ble:pod:stream:start found specific pod data', data[selectedGraphPod])
            setGraphData(data[selectedGraphPod]);
          }
        }

        if ("ble:pod:connect" === code && noError) {
          console.log("ble:pod:connect");
        }

        if ("ble:pod:start" === code && noError) {
          console.log("bleStart");
        }

        // if ('ble:debug:start' === code && noError) {
        //   setDebugInfo({
        //     enabled: true,
        //     data: {},
        //   })
        // }

        // if ('ble:debug:stop' === code && noError) {
        //   setDebugInfo({
        //     enabled: false,
        //     data: {},
        //   })
        // }

        if ("prompt:encryption:key" === code) {
          openEncryptionModal(data);
        }

        if ("ble:encryption:set" === code) {
          if (error) {
            handleEncryptionModalError(
              typeof error === "string" ? error : "An unknown error occured."
            );
          } else {
            handleEncryptionModalSuccess();
          }
        }
      }
    };
    processMsg();
  }, [lastJsonMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // useEffect(() => {
  //   console.log('useEffect encryptionModalPending')
  //   if (encryptionModalPending
  //     && encryptionModalPending.length
  //     && !encryptionModal.visible) {
  //     openEncryptionModal({ peripheralId: encryptionModalPending[0] })
  //   }
  // }, [encryptionModalPending])

  const startScan = () => {
    sendJsonMessage({
      code: "ble:scan:start",
    });
  };

  const stopScan = () => {
    sendJsonMessage({
      code: "ble:scan:start",
    });
  };

  const connectPod = (peripheralId) => {
    sendJsonMessage({
      code: "ble:pod:connect",
      data: {
        peripheralId,
      },
    });
  };

  const disconnectPod = (peripheralId) => {
    sendJsonMessage({
      code: "ble:pod:disconnect",
      data: {
        peripheralId,
      },
    });
  };

  const startPodData = (peripheralId) => {
    sendJsonMessage({
      code: "ble:pod:stream:start",
      data: {
        peripheralId,
      },
    });
  };

  const stopPodData = (peripheralId) => {
    sendJsonMessage({
      code: "ble:pod:stream:stop",
      data: {
        peripheralId,
      },
    });
  };

  // const startDebug = () => {
  //   sendJsonMessage({
  //     code: 'ble:debug:start',
  //     data: {},
  //   })
  // }

  // const stopDebug = () => {
  //   sendJsonMessage({
  //     code: 'ble:debug:stop',
  //     data: {},
  //   })
  // }

  const promptUserForSettings = (peripheralId) => {
    if (
      settingsPromptPromise.current &&
      settingsPromptPromise.current.resolve &&
      settingsPromptPromise.current.reject
    ) {
      settingsPromptPromise.current.reject(new Error("usercancel"));
    }

    const p = new Promise((resolve, reject) => {
      settingsPromptPromise.current = {
        resolve,
        reject,
      };
    });
    const pod = connectedPods[peripheralId];
    if (pod && pod.settings && pod.settings.csvFileName) {
      const settings = {
        saveInterval: `${pod.settings.saveInterval / 1000}`,
        saveNumber:
          pod.settings.saveNumber === false
            ? "0"
            : `${pod.settings.saveNumber}`,
        csvFileName: pod.settings.csvFileName,
        taskName: pod.settings.taskName,
        partId: pod.settings.partId,
        test: pod.settings.test,
      };
      setSettingsFormValues(Object.assign(defaultSettings, settings));
    }
    setSettingsPromptModalVisible(true);

    return p;
  };

  const startGlobalPods = async () => {
    try {
      for (let peripheralId in connectedPods) {
        if (connectedPods[peripheralId].isSaving) {
          showNotification({
            title: "Universal Pod Start",
            message: `Pod Detected in active Recording. Universal Recording disabled`,
            type: STATUSES.WARNING,
          });

          return;
        }
      }

      setIsRecording(true);

      //got settings
      console.log("prompting user for settings");
      const _settings = await promptUserForSettings(
        Object.keys(connectedPods)[0]
      );

      const settings = {
        saveInterval: parseInt(_settings.saveInterval) * 1000,
        saveNumber:
          _settings.saveNumber === "0" ? false : parseInt(_settings.saveNumber),
        csvFileName: _settings.csvFileName,
        taskName: _settings.taskName,
        partId: _settings.partId,
        test: _settings.test,
      };
      console.log("got settings, parsed it", { settings, _settings });

      for (let peripheralId in connectedPods) {
        // await startPod(peripheralId)
        sendJsonMessage({
          code: "ble:pod:start",
          data: {
            peripheralId,
            settings,
          },
        });
      }

      setIsRecording(false);
      showNotification({
        title: "Universal Pod Start",
        message: `Universal Pod Start has completed`,
        type: STATUSES.SUCCESS,
      });
    } catch (err) {
      if (err?.message === "usercancel") {
        console.log("user cancelled previous promise for settings");
        setIsRecording(false);
      } else {
        console.warn(err);
        setIsRecording(false);
      }
    }
  };

  const startPod = async (peripheralId) => {
    try {
      console.log("prompting user for settings");
      const _settings = await promptUserForSettings(peripheralId);
      // console.log('got settings', JSON.stringify(_settings))
      // return;
      const settings = {
        saveInterval: parseInt(_settings.saveInterval) * 1000,
        saveNumber:
          _settings.saveNumber === "0" ? false : parseInt(_settings.saveNumber),
        csvFileName: _settings.csvFileName,
        taskName: _settings.taskName,
        partId: _settings.partId,
        test: _settings.test,
      };
      console.log("got settings, parsed it", { settings, _settings });
      sendJsonMessage({
        code: "ble:pod:start",
        data: {
          peripheralId,
          settings,
        },
      });
    } catch (err) {
      if (err?.message === "usercancel") {
        console.log("user cancelled previous promise for settings");
      } else {
        console.warn(err);
      }
    }
  };

  const stopPod = (peripheralId) => {
    sendJsonMessage({
      code: "ble:pod:stop",
      data: {
        peripheralId,
      },
    });
  };

  /*
    Settings Prompt Functions
  */

  const handleSettingsPromptModalClose = () => {
    setSettingsPromptModalVisible(false);
    console.log("handleSettingsPromptModalClose called");
    setSettingsFormValues(defaultSettings);
    settingsPromptPromise.current.reject(new Error("usercancel"));
  };

  const handleSaveSettings = () => {
    console.log("settingsFormValues", JSON.stringify(settingsFormValues));
    const ks = Object.keys(settingsFormValues);
    let isInvalid = true;
    for (let i = 0; i < ks.length; i++) {
      console.log("handleSaveSettings", {
        k: ks[i],
        settingsFormValues,
      });
      const validator = settingsValidation[ks[i]];

      if (validator instanceof RegExp) {
        console.log("match regex", {
          reg: settingsFormValues[ks[i]].match(settingsValidation[ks[i]]),
        });
        isInvalid =
          settingsFormValues[ks[i]].match(settingsValidation[ks[i]]) === null;
      } else if (typeof validator === "function") {
        console.log("match function", {
          val: validator(settingsFormValues[ks[i]]),
          fv: settingsFormValues[ks[i]],
        });
        isInvalid = !validator(settingsFormValues[ks[i]]);
      } else {
        console.log(
          "unsupported validator, will pass data to backend",
          validator
        );
      }
      if (isInvalid) {
        return showNotification({
          title: "Validation Error",
          message: `${ks[i]} is not valid. Please provide a valid value.`,
          type: STATUSES.ERROR,
        });
      }
    }

    settingsPromptPromise.current.resolve(settingsFormValues);
    setSettingsPromptModalVisible(false);
  };

  const settingsFormValueUpdate = (key, val) => {
    setSettingsFormValues({
      ...settingsFormValues,
      [key]: val,
    });
  };

  /*
    Pod Graph Functions
  */

  const handleGraphModalClose = () => {
    stopPodData(selectedGraphPod);
    setSelectedGraphPod("");
    setGraphModalVisible(false);
    setGraphModaImuVisible(false);

    // stop data coming in?
  };

  const openGraphModal = (peripheralId) => {
    setSelectedGraphPod(peripheralId);
    startPodData(peripheralId);
    setGraphModalVisible(true);

    let firmwareType = connectedPods[peripheralId].metadata.firmwareType;
    if (firmwareType === "udw_FW700") {
      setGraphModaImuVisible(true);
    } else {
      setGraphModalVisible(true);
    }
  };

  /*
    Pod Encryption Prompt/Modal Functions
  */

  const getStoredEncryption = (peripheralId) => {
    const serialNumber = connectedPods[peripheralId]?.metadata?.serialNumber;
    if (serialNumber) {
      return encryptionDB.find((r) => r.serialNumber === serialNumber);
    }
    return undefined;
  };

  const handleEncryptionModalError = (error) => {
    setEncryptionModal({ ...encryptionModal, loading: false, error });
  };

  const handleEncryptionModalSuccess = () => {
    showNotification({
      title: "Encryption pair set",
      message: `Encryption pair has been set for pod.`,
      type: STATUSES.SUCCESS,
    });
    const idx = encryptionModalPending.indexOf(encryptionModal.peripheralId);
    if (idx !== -1) {
      //
      encryptionModalPending.splice(idx, 1);
      setEncryptionModalPending(encryptionModalPending);
    }
    setEncryptionModal(ENCRYPTION_MODAL_INIT_STATE);
  };

  const handleEncryptionModalClose = () => {
    // stopPodData(selectedGraphPod)
    // setSelectedGraphPod('')
    // setGraphModalVisible(false)
    setEncryptionModal(ENCRYPTION_MODAL_INIT_STATE);
  };

  const handleEncryptionSave = async () => {
    setEncryptionModal({ ...encryptionModal, loading: true });
    sendJsonMessage({
      code: "ble:encryption:set",
      data: {
        peripheralId: encryptionModal.peripheralId,
        key: encryptionModal.key,
        digit: encryptionModal.digit,
      },
    });
  };

  const openEncryptionModal = ({ peripheralId, key, digit }) => {
    console.log("++ openEncryptionModal", {
      peripheralId,
      connected: connectedPods[peripheralId],
      dc: podList[peripheralId],
      podList,
      connectedPods,
    });
    const storedPair = getStoredEncryption(peripheralId);
    key = key || storedPair?.key || "";
    digit = digit || storedPair?.digit || "";
    setEncryptionModal({
      peripheralId,
      visible: true,
      key,
      digit,
    });
  };

  return (
    <BleContext.Provider
      value={{
        // ...state,
        isRecordingGlobal,
        isScanning,
        lastScan,
        connectedPods,
        podList,
        stopScan,
        startScan,
        startGlobalPods,
        startPod,
        stopPod,
        connectPod,
        disconnectPod,
        connectionStatus,
        openGraphModal,
        openEncryptionModal,
        lastErrorMsg,
        // ...state,
        // prevModals,
        // onBackModal,
        // openModal,
        // setModalLoading,
        // closeModal,
      }}
    >
      {appState === AppStatus.RUNNING ? (
        props.children
      ) : (
        <Container style={{ marginTop: "150px" }}>
          <Card className="text-center">
            <Card.Header>App Status</Card.Header>
            <Card.Body>
              <Card.Title>
                App {appSuspended.is ? "is suspended" : appStatus}
              </Card.Title>
              <Card.Text>
                {appSuspended.is ? appSuspended.reason : <></>}
              </Card.Text>
            </Card.Body>
          </Card>
        </Container>
      )}

      <Navbar fixed="bottom" bg="light">
        <Container fluid>
          <Navbar.Brand>
            <img
              src={AppLogo}
              width="30"
              height="30"
              className="d-inline-block align-top"
              alt="PodHub"
            />
          </Navbar.Brand>

          <Navbar.Toggle />
          <Navbar.Collapse className="justify-content-end">
            {readyState === ReadyState.OPEN && (
              <OverlayTrigger
                placement={"top"}
                trigger={["click"]}
                rootClose
                overlay={
                  <Popover id="popover-appinfo" className="popover-appinfo">
                    <Popover.Header as="h3">App info</Popover.Header>
                    <Popover.Body>
                      {appSuspended.is ? (
                        <Alert variant={"warning"}>
                          <Alert.Heading>App is suspended</Alert.Heading>
                          App has shut off operations. <br />
                          <hr />
                          reason: {appSuspended.reason}
                        </Alert>
                      ) : (
                        <Alert variant={"success"}>
                          <Alert.Heading>App is running</Alert.Heading>
                        </Alert>
                      )}

                      {debugInfo.enabled && (
                        <>
                          <h6>Disk Usage</h6>
                          <ListGroup horizontal={"md"} className="my-2">
                            <ListGroup.Item>
                              Total:{" "}
                              {prettyBytes(debugInfo.data.diskspace.size)}
                            </ListGroup.Item>
                            <ListGroup.Item>
                              Free: {prettyBytes(debugInfo.data.diskspace.free)}
                            </ListGroup.Item>
                            <ListGroup.Item>
                              Path: {debugInfo.data.diskspace.diskPath}
                            </ListGroup.Item>
                          </ListGroup>

                          <h6>Memory Usage</h6>
                          <ListGroup className="my-2">
                            <ListGroup.Item>
                              Heap: {debugInfo.data.heapTotal}/
                              {debugInfo.data.heapUsed} (total/used)
                            </ListGroup.Item>
                            <ListGroup.Item>
                              External: {debugInfo.data.external} <br />
                              <small>
                                refers to the memory usage of C++ objects bound
                                to JavaScript objects managed by V8.
                              </small>
                            </ListGroup.Item>
                            <ListGroup.Item>
                              RSS: {debugInfo.data.rss} <br />
                              <small>
                                Resident Set Size, is the amount of space
                                occupied in the main memory device (that is a
                                subset of the total allocated memory) for the
                                process, including all C++ and JavaScript
                                objects and code.
                              </small>
                            </ListGroup.Item>
                          </ListGroup>
                        </>
                      )}
                    </Popover.Body>
                  </Popover>
                }
              >
                <Navbar.Text
                  style={{ cursor: "pointer" }}
                  as="div"
                  className="me-4"
                >
                  <FontAwesomeIcon
                    className={`me-1 text-${appStatusBackground}`}
                    icon={faCircle}
                  />{" "}
                  App {appStatus}
                </Navbar.Text>
              </OverlayTrigger>
            )}

            <OverlayTrigger
              overlay={
                <Tooltip id="tooltip-socket">Socket Url {socketUrl}</Tooltip>
              }
            >
              <Navbar.Text style={{ cursor: "pointer" }} className="me-4">
                <FontAwesomeIcon
                  className={`me-1 text-${connectionStatusBackground}`}
                  icon={faCircle}
                />{" "}
                Socket is {connectionStatus}
              </Navbar.Text>
            </OverlayTrigger>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <Modal
        show={settingsPromptModalVisible}
        onHide={handleSettingsPromptModalClose}
      >
        <Modal.Header closeButton>
          <Modal.Title>Settings for new session</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3" controlId="formSettingsPartId">
              <Form.Label>Participant ID</Form.Label>
              <Form.Control
                onChange={(e) =>
                  settingsFormValueUpdate("partId", e.target.value)
                }
                value={settingsFormValues.partId}
                type="text"
                placeholder="Enter your Participantion ID."
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="formSettingsTaskName">
              <Form.Label>Task Name</Form.Label>
              <Form.Control
                onChange={(e) =>
                  settingsFormValueUpdate("taskName", e.target.value)
                }
                value={settingsFormValues.taskName}
                type="text"
                placeholder="Enter task name"
              />
            </Form.Group>

            <Form.Group className="mb-3" controlId="formSettingsFileName">
              <Form.Label>CSV Filename</Form.Label>
              <Form.Control
                onChange={(e) =>
                  settingsFormValueUpdate("csvFileName", e.target.value)
                }
                value={settingsFormValues.csvFileName}
                type="text"
                placeholder="Enter CSV Filename"
              />
              <Form.Text muted>
                This value will be prepended to files generated by this session.
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3" controlId="formSettingsSaveInterval">
              <Form.Label>Save Interval</Form.Label>
              <Form.Control
                onChange={(e) =>
                  settingsFormValueUpdate("saveInterval", e.target.value)
                }
                value={settingsFormValues.saveInterval}
                type="text"
                placeholder="Enter save interval"
              />
              <Form.Text muted>
                Interval in seconds to dump data into files{" "}
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3" controlId="formSettingsSaveDuration">
              <Form.Label>Save Number</Form.Label>
              <Form.Control
                onChange={(e) =>
                  settingsFormValueUpdate("saveNumber", e.target.value)
                }
                value={settingsFormValues.saveNumber}
                type="text"
                placeholder="Enter save duration"
              />
              <Form.Text muted>
                Number of files to save, total save duration will be calculated
                base on this, (0) will run indefinitely
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-3" controlId="formSettingsTestRun">
              <Form.Check
                type="switch"
                id="formSettingsTest"
                label="Test mode"
                checked={settingsFormValues.test}
                onChange={(e) =>
                  settingsFormValueUpdate("test", !settingsFormValues.test)
                }
              />
              <Form.Text muted>
                Test mode will behave the same as regular except for saving
                files.
              </Form.Text>
            </Form.Group>

            {/* <Button variant="primary" type="submit">
                          Submit
                        </Button> */}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleSettingsPromptModalClose}>
            Close
          </Button>
          <Button variant="primary" onClick={handleSaveSettings}>
            Start recording
          </Button>
        </Modal.Footer>
      </Modal>

      <GraphModal
        show={graphModalVisible}
        onHide={handleGraphModalClose}
        selectedPod={selectedGraphPod}
        signalOptions={
          selectedGraphPod
            ? connectedPods[selectedGraphPod].metadata.signalOptions
            : []
        }
        data={graphData}
        firmwareType={
          selectedGraphPod
            ? connectedPods[selectedGraphPod].metadata.firmwareType
            : ""
        }
        ECGSampleCount={
          selectedGraphPod
            ? connectedPods[selectedGraphPod].metadata.ECGSampleCount
            : 24
        }
        ECGPacketInterval={
          selectedGraphPod
            ? connectedPods[selectedGraphPod].metadata.ECGPacketInterval
            : 75
        }
      />

      <GraphModalImu
        show={graphModalImuVisible}
        onHide={handleGraphModalClose}
        selectedPod={selectedGraphPod}
        signalOptions={
          /**selectedGraphPod ? connectedPods[selectedGraphPod].metadata.signalOptions : []**/ [
            { id: 1, value: "X" },
            { id: 2, value: "Y" },
            { id: 3, value: "Z" },
          ]
        }
        data={graphData}
        firmwareType={
          selectedGraphPod
            ? connectedPods[selectedGraphPod].metadata.firmwareType
            : ""
        }
        IMUSampleCount={12}
        IMUPacketInterval={120}
        // IMUSampleCount={selectedGraphPod ? connectedPods[selectedGraphPod].metadata.ACCSampleCount : 12}
        // IMUPacketInterval={selectedGraphPod ? connectedPods[selectedGraphPod].metadata.IMUPacketInterval: 12}
      />

      <EncryptionModal
        show={encryptionModal.visible}
        podIdentifier={
          encryptionModal.peripheralId !== null && (
            <>
              {podList[encryptionModal.peripheralId].advertisement.localName} (
              {podList[encryptionModal.peripheralId].metadata.serialNumber})
            </>
          )
        }
        error={encryptionModal.error}
        choices={encryptionDB}
        keyValue={encryptionModal.key}
        digitValue={encryptionModal.digit}
        onSave={handleEncryptionSave}
        onValueChange={(changes) => {
          setEncryptionModal({ ...encryptionModal, ...changes });
        }}
        onHide={handleEncryptionModalClose}
      />
    </BleContext.Provider>
  );
};

export const BleConsumer = BleContext.Consumer;

export const withBleContext = (Component) => (props) =>
  (
    <BleConsumer>
      {(providerProps) => (
        <Component {...props} bleContextProps={providerProps} />
      )}
    </BleConsumer>
  );
