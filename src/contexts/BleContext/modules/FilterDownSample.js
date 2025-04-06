/* eslint-disable camelcase,no-sequences */

export default class FilterDownSample {
    constructor(sampling_frequency = 320, downsampling_rate = 2, block_size) {
      // console.log('FilterDownSample constructor', {sampling_frequency, downsampling_rate, block_size})
    this._sampling_frequency = sampling_frequency;
    // Uncomment this if downsampling is needed
      // this._downsampling_rate = downsampling_rate;
    this._block_size = block_size;

        this.lowpass_cutoff = 40;
        this.highpass_cutoff = 1;

      this.b_n = [0.95654323, 1.18293616, 2.27881429, 1.18293616, 0.95654323];
      this.a_n = [1.0, 1.20922304, 2.27692491, 1.15664927, 0.91497583];
      this.z_n = [0, 0, 0, 0];

      this.b_h = [0.97803048, -1.95606096, 0.97803048];
        this.a_h = [1.0, -1.95557824, 0.95654368];
        this.z_h = [0, 0];

      this.b_l = [0.20657208, 0.41314417, 0.20657208];
        this.a_l = [1.0, -0.36952738, 0.19581571];
      this.z_l = [0, 0];

      this.x_pre_n = new Array(this._block_size).fill(0);
      this.y_pre_n = new Array(this._block_size).fill(0);
      this.x_pre_h = new Array(this._block_size).fill(0);
      this.y_pre_h = new Array(this._block_size).fill(0);
      this.x_pre_l = new Array(this._block_size).fill(0);
      this.y_pre_l = new Array(this._block_size).fill(0);
      this.filtered_data = new Array(this._block_size).fill(0);
  }

  _filter(signal, a, b, x_pre, y_pre) {
      let index = 0;
      let i = 0;
    // console.log("in the filter function. The signal is: ", signal)
        for (index = 0; index < signal.length; index += 1) {
            for (i = 0; i < x_pre.length - 1; i += 1) {
                x_pre[i] = x_pre[i + 1];
      }
      x_pre[x_pre.length - 1] = signal[index];

            let AR_part = 0;
      for (i = 0; i < a.length - 1; i += 1) {
                AR_part += a[i + 1] * y_pre[this._block_size - i - 1];
      }

            let MA_part = 0;
      for (i = 0; i < b.length; i += 1) {
                MA_part += b[i] * x_pre[this._block_size - i - 1];
      }

            const y_new = (MA_part - AR_part) / a[0];

      for (i = 0; i < y_pre.length - 1; i += 1) {
                y_pre[i] = y_pre[i + 1];
      }
            y_pre[x_pre.length - 1] = y_new;

            this.filtered_data[index] = y_new;
    }
    // console.log("in the filter function. The filtered data is: ", this.filtered_data)

    return x_pre, y_pre;
  }

  filter_downsample(input) {
    if (input.length !== this._block_size) {
      console.error('filter_downsample length error ', [input.length, this._block_size])
      return [];/* raise error */
    }
    /* remove the 0xFF values */
    const signal_in_clean = new Array(this._block_size).fill(0);

    let i = 0;
    for (i = 0; i < this._block_size; i += 1) {
      if ((input[i] > (2 ** 23)) || (input[i] < -(2 ** 23))) {
        signal_in_clean[i] = 0;
      } else {
        signal_in_clean[i] = input[i];
      }
    }
    /* notch filter */
    // eslint-disable-next-line no-unused-expressions
    this.x_pre_n, this.y_pre_n = this._filter(signal_in_clean, this.a_n, this.b_n, this.x_pre_n, this.y_pre_n);
    /* highpass filter */
    // eslint-disable-next-line no-unused-expressions
    this.x_pre_h, this.y_pre_h = this._filter(this.filtered_data, this.a_h, this.b_h, this.x_pre_h, this.y_pre_h);
    /* lowpass filter */
    // eslint-disable-next-line no-unused-expressions
    this.x_pre_l, this.y_pre_l = this._filter(this.filtered_data, this.a_l, this.b_l, this.x_pre_l, this.y_pre_l);

    // Uncomment these if downsampling is needed and return "output"
    // const output = new Array(Math.floor(this._block_size / this._downsampling_rate)).fill(0);

    // for (i = 0; i < output.length; i += 1) {
        //     output[i] = Math.round(this.filtered_data[this._downsampling_rate * i]);
    // }

    return this.filtered_data;
  }
}
