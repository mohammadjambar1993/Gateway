function extractDatapoints(ecgData, filter = null) {
  const dataPoints = [];
  if (ecgData.length === 0) {
    return dataPoints;
  }

  const data = filter ? filter(ecgData) : ecgData;

  if (data.length === 0) {
    return dataPoints;
  }

  let lastTS = data[0].timestamp - 40;
  data.forEach((measurement) => {
    const { values } = measurement;
    const tsDiff = values.timestamp - lastTS;
    if (tsDiff > 40) {
      const numberOfMissed = Math.floor((tsDiff - 40) / 40);
      for (let i = 0; i < numberOfMissed * 8; i += 1) {
        dataPoints.push(null);
      }
    }
    lastTS = values.timestamp;
    Object.keys(values).forEach((key) => {
      if (key.startsWith("sample")) {
        dataPoints.push(values[key]);
      }
    });
  });
  return dataPoints;
}

function flattenSample(item) {
  const flat = [];
  Object.keys(item).forEach((key) => {
    if (key.startsWith("sample")) {
      flat.push(item[key]);
    }
  });

  return flat;
}

function flattenSamples(arr) {
  let flat = [];

  if (!arr) {
    return flat;
  }

  arr.forEach((item) => {
    flat = flat.concat(flattenSample(item.values));
  });

  return flat;
}

function flattenSamplesV2(arr) {
  let flat = [];

  arr.forEach((item) => {
    flat = flat.concat([...new Int16Array(item.values)]);
  });

  return flat;
}

module.exports = {
  extractDatapoints,
  flattenSample,
  flattenSamples,
  flattenSamplesV2,
};
