import React, {
  useContext,
  // useState
} from "react";
import {
  BleContext
} from "../contexts/BleContext";
import PodList from "../contexts/BleContext/components/PodList";


const Home = () => {
  const {
    connectedPods,
    podList,
  } = useContext(BleContext);

  return (<>
    <PodList
      title={'Connected pods'}
      subtitle={'You start new sessions here, monitor currently active sessions etc.'}
      list={connectedPods}
      enableGlobalStartButton={Object.keys(connectedPods).length>0}
    />

    <PodList
      title={'Connect to nearby pods'}
      subtitle={'Search for and connect to nearby pods.'}
      list={podList}
      enableScanButton={true}
    />
  </>)
};

export default Home
