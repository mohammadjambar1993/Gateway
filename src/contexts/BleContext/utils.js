export function flattenSample(item) {
  const flat = [];
  Object.keys(item).forEach((key) => {
    if (key.startsWith("sample")) {
      flat.push(item[key]);
    }
  });

  return flat;
}

export function flattenSamples(arr) {
  let flat = [];

  if (!arr) {
    return flat;
  }

  arr.forEach((item) => {
    flat = flat.concat(flattenSample(item.values));
  });

  return flat;
}