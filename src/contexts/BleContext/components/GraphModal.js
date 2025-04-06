import React, {
  useState,
  useEffect,
  // useMemo,
  useRef,
} from "react";

import Modal from 'react-bootstrap/Modal';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import ButtonGroup from 'react-bootstrap/ButtonGroup';
import ButtonToolbar from 'react-bootstrap/ButtonToolbar';


import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import 'chartjs-adapter-luxon';
// import ChartStreaming from 'chartjs-plugin-streaming';
import { StreamingPlugin, RealTimeScale } from "chartjs-plugin-streaming";


import { Line } from 'react-chartjs-2';

import { flattenSample } from '../utils'
import FilterDownsample from '../modules/FilterDownSample'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  // ChartStreaming
  StreamingPlugin,
  RealTimeScale
);

// Chart.defaults.set('plugins.streaming', {
//   duration: 20000
// });


// Constants used for graphs. Time is in milliseconds
export const TIME_BETWEEN_POINTS = 5;
export const TIME_PER_GRAPH = 3000;
export const POINTS_PER_GRAPH = 1600; // changed from 600
export const ECG_GRAPH_MAX_VALUE = 4200000// 20000; // some max > 2^14
export const RAW_ECG_GRAPH_MAX_VALUE = 8400000 // 17000000; // some max > 2^23 --Used to be 33000 for 2-byte ECG 


export const GraphModal = ({ firmwareType, show, onHide, selectedPod, signalOptions, data, ECGSampleCount, ECGPacketInterval }) => {

  const [currentChannel, setCurrentChannel] = useState(1)
  const [shouldFilter, setShouldFilter] = useState(true)
  const [dataStream, setDataStream] = useState([])

  // const [graphLabels, setGraphLabels] = useState([])

  const sampling_frequency = (ECGSampleCount * 1000) / ECGPacketInterval
  const BLOCK_SIZE = ECGSampleCount

  // const filterDownSample = useMemo(() => new FilterDownsample(sampling_frequency, 2, BLOCK_SIZE), [BLOCK_SIZE, sampling_frequency, currentChannel]);
  const filterDownSample = useRef(null)

  // console.log('GraphModal')


  const downSizeDeduct = (data) => {
      // Do not downsize if it's an older version of pod
      if(firmwareType === 'prodV1'){
        return data
      }

      const newData = new Array(BLOCK_SIZE).fill(0);
      for (let i = 0; i < data.length; i += 1){ 
          newData[i] = Math.floor(data[i] - 8388608)  // Deduct 2^23 from the values to change to signed number
      }
      return newData
  }

  // this takes only ONE block
  const filterBasedOnBlock = (data, isLive=true) => {
    // console.log('filterBasedOnBlock', data)

    // const dataTmp = new Array(BLOCK_SIZE).fill(0);
    // for (let i = 0; i < BLOCK_SIZE; i += 1) {
    //     if (data[i]) {
    //         dataTmp[i] = data[i];
    //     }
    // }
    // console.log('filterDownSample', filterDownSample)
    const output = filterDownSample.current.filter_downsample(data);
    // console.log('output', output)
    return output
      // const newData = this.filteredData.concat(output);
      // this.filteredData = newData;
      // if (isLive) {
      //     if (this.filteredData.length > POINTS_PER_GRAPH) { // changed from 600
      //         this.filteredData = this.filteredData.slice(-1 * POINTS_PER_GRAPH); // changed from 600
      //     }
      // }
  }

  // const onRefresh = (chart) => {
  //   const now = Date.now();
  //   const newUpdates = dataStream
  //   console.log('newUpdates', { newUpdates, ds: chart.data.datasets[0] })
  //   setDataStream([])
  //   // chart.data.datasets[0].data.push(...newUpdates);
  //   const vv = {
  //     x: now,
  //     y: randomIntFromInterval(-100,100),
  //   }
  //   console.log('vv', vv)
  //   chart.data.datasets[0].data.push(vv);
  //   // chart.data.datasets.forEach((dataset) => {
  //   //   console.log('onRefresh dataset')
  //   //   dataset.data.push(...);
  //   // });
  // }

  useEffect(() => {
    // this runs everytime data value changes. 
    if (data?.ecg?.length) {
      // console.log('graph data has been changed', JSON.stringify(data.ecg[currentChannel-1]))
      // const flatten = []
      const output = []
      // const ts = []
      data.ecg[currentChannel-1].forEach((item, idx) => {
        // console.log('item ts ', item.timestamp)
        // if (data.ecg[currentChannel-1][idx-1]) {
        //   console.log('diff', data.ecg[currentChannel-1][idx-1].timestamp - item.timestamp)
        // }
        const flatten = flattenSample(item)
        let downsizedData = downSizeDeduct(flatten)
        // console.log('shouldFilter', {shouldFilter, downsizedData})
        if (shouldFilter) {
          downsizedData = filterBasedOnBlock(downsizedData);
        }

        const tsBit = ECGPacketInterval / ECGSampleCount
        downsizedData.forEach((dataBit, idxx) => {
          const now = Date.now();
          output.push({
            // x: item.timestamp + (idxx * tsBit),
            x: now + (idxx * tsBit),
            y: dataBit,
            // y: randomIntFromInterval(-100, 100)
          })
          // output.push(dataBit)
          // ts.push(item.timestamp + (idxx * tsBit))
        })
      })

      // console.log('output', output.length)

      let newDataStream = [...dataStream, ...output]
      if (newDataStream.length > POINTS_PER_GRAPH) {
        newDataStream = newDataStream.slice(-1 * POINTS_PER_GRAPH)
      }

      // console.log('newDataStream', newDataStream.length)
      // setGraphLabels(ts)
      setDataStream(newDataStream)

      // if (newDataStream.length !== graphLabels.length) {
      //   const newGraphLabels = new Array(newDataStream.length)
      //   for (let i = 0; i < newDataStream.length; i++) {
      //     newGraphLabels[i] = i
      //   }
      //   setGraphLabels(newGraphLabels)
      // }
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDataStream([])
  }, [currentChannel, shouldFilter])

  useEffect(() => {
    if (!show) {
      setDataStream([])
    } else {
      // 
    }
  }, [show])

  useEffect(() => {
    // console.log('filterDownSample.current', {BLOCK_SIZE, sampling_frequency})
    filterDownSample.current = new FilterDownsample(sampling_frequency, 2, BLOCK_SIZE)
  }, [show, BLOCK_SIZE, sampling_frequency])//, currentChannel])

  return (<Modal show={show} onHide={onHide}>
    <Modal.Header closeButton>
      <Modal.Title>Pod Graph {selectedPod}</Modal.Title>
    </Modal.Header>
    <Modal.Body>

      <ButtonToolbar className="align-items-center" aria-label="Graph options">
        <ButtonGroup className="me-2" aria-label="Channel options">
          {Object.values(signalOptions).map((opt) => (
            <Button
              key={opt.id}
              onClick={()=> {
                setCurrentChannel(opt.id)
              }}
              active={opt.id === currentChannel}
            >
              {opt.value}
            </Button>
          ))}
        </ButtonGroup>
        
        {/*<ButtonGroup aria-label="Third group">
          <Button>8</Button>
        </ButtonGroup>*/}

        <Form.Check 
          type="switch"
          id="filter-switch"
          label={shouldFilter ? "Filtered data" : "Raw data" }
          checked={shouldFilter}
          onChange={(e) => setShouldFilter(!shouldFilter)}
        />
      </ButtonToolbar>

      <Line
        options={{
          scales: {
            y: {
              title: {
                display: true,
                text: "Value",
              },
              grid: {
                display: false,
              },
            },
            x: {
              title: {
                display: false,
              },
              ticks: {
                display: false, //this will remove only the label
              },
              grid: {
                display: false,
              },
            },
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              enabled: false,
            },
          },
        }}
        data={{
          labels: dataStream.map((d) => d.x),
          datasets: [{
            borderColor: 'blue',
            backgroundColor: 'blue',
            label: '',
            data: dataStream,
            pointRadius: 0,
            showLine: true,
          }]
        }}
      />
    </Modal.Body>
    <Modal.Footer>
      <Button variant="secondary" onClick={onHide}>
        Close
      </Button>
    </Modal.Footer>
  </Modal>)
}


