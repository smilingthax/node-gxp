"use strict";

const HID = require('node-hid');

// (like edid checksum ...)
function csum(ar) { // {{{
  const sum = ar.reduce((acc, c) => (acc + c)&0xff, 0);
  return (-sum)&0xff;
}
// }}}

function mkpkt(type, cmd, ar) { // {{{
  const ret = Buffer.alloc(64);
  ret[0] = type;
  ret[1] = ar.length + 1;
  ret[2] = cmd;
  ret.set(ar, 3);

//  ret[ar.length + 3] = csum(ret);  // (will ignore trailing 0's ...)
  ret[ar.length + 3] = csum(ret.slice(0, ar.length + 2));
  return ret;
}
// }}}

function parsepkt(buf) { // {{{
  if (buf.length != 64 || buf[1] >= 64) {
    throw new Error('Unexpected data length');
  }
//  if (csum(buf.slice(0, buf[1]+2)) !== 0) {
  if (csum(buf) !== 0) {
    console.log('bad checksum', buf);
    return {};
  }
  return {
    type: buf[0],
    ack: !(buf[2] & 0x80),
    cmd: buf[2] & 0x7f,
    data: Buffer.from(buf.slice(3, buf[1] + 2))
  };
}
// }}}

class MatroxGXP {
  constructor(dev) {
    this.dev = new HID.HID(dev.path);  // TODO?  try/catch  (esp. permission denied...)?
    this._timeout = 250; // ms
    this.debug = !true;
  }

  info() {
    return this.dev.getDeviceInfo();  // -> manufacturer, product, serialNumber
  }

  // 0xa0  0x00  uint16_BE(pos)  I2C position    ?     [(+note: 0xa0  is "DDC i2c address")]
  // 0xa0  0x02  uint8(size)     I2C read length ?
  read_eeprom(pos, size) { // {{{
    this._send(0xa0, 0x00, [(pos >> 8) & 0xff, pos & 0xff]);
    if (!this._recv().ack) {
      console.log('read_eeprom failed with NACK (position)');
      return false;
    }

    const ret = [];
    while (size > 0x3c) { // 60
      this._send(0xa0, 0x02, [0x3c]);
      size -= 0x3c;
      const res = this._recv();
      if (!res.ack) {
        console.log('read_eeprom failed with NACK (length)');
        return false;
      }
      // assert(res.data.length === 0x3c);
      ret.push(res.data);
    }

    this._send(0xa0, 0x02, [size]);
    const res = this._recv();
    if (!res.ack) {
      console.log('read_eeprom failed with NACK (length)');
      return false;
    }
    // assert(res.data.length === size);
    ret.push(res.data);

    return Buffer.concat(ret);
  }
  // }}}

  // 0xde  0x31  uint8(size)  uint8(from)   read ram ??
  read_state(from, size) { //  {{{
    const ret = this._read_block(0xde, 0x31, size, from);
    if (ret === false) {
      console.log('read_state failed with NACK');
      return false;
    }
    return ret;
  }
  // }}}

  // 0xde  0x30  uint8(pos)  uint8(byte)
  write_state(pos, bytes) { // {{{
    for (let i = 0; i < bytes.length; i++) {
      if (!this._write_byte(0xde, 0x30, pos + i, bytes[i])) {
        return false;
      }
    }
    return true;
  }
  // }}}

  // this seems to be the firmware default edid ...
  get_edid_from_eeprom() { // {{{
    return this.read_eeprom(0x1d98, 128);
  }
  // }}}

  // 0xa0  0x23  uint8(len) uint16_BE(pos)[?]
  get_edid() { // {{{
    // NOTE: like this._read_block(0xa0, 0x23, 128, 0x00);  // not usable, 3 bytes (len, pos, ?) are used here instead of 2 ...
    const from = 0x00, size = 128;
    const ret = [];
    let pos = 0;
    while (pos < size) {
      this._send(0xa0, 0x23, [Math.min(size - pos, 0x3c), (from + pos) & 0xff, ((from + pos) >> 8) & 0xff]); // read max 0x3c(60) bytes from pos
      const res = this._recv();
      if (!res.ack) {
        return false;
      }
      ret.push(res.data);
      pos += res.data.length;
    }
    return Buffer.concat(ret, size);
  }
  // }}}

//  TODO: set_edid(data)

  // or? (product id??)
  read_vpp_firmware_version() { // {{{
    const ret = this.read_state(0x04, 0x01);
    return ret ? ret[0] : false;
  }
  // }}}

  read_firmware_version() { // {{{
    const ret = this.read_state(0x34, 0x03);
    return ret ? [...ret].reverse() : false;
  }
  // }}}

  read_serial_from_state() { // {{{
    const ret = this.read_state(0x86, 8);  // TODO? 12?
    return ret ? ret.toString() : false;
  }
  // }}}

  read_video_state() { // {{{
    const res = this.read_state(0x50, 0x30);
    if (!res) {
      return false;
    }
    return {
      v_total1: res.readUInt16LE(0x04),
      h_total1: res.readUInt16LE(0x0c),

      v_active_half1: res.readUInt16LE(0x0e),
      v_active_half2: res.readUInt16LE(0x10),

      v_active_out1: res.readUInt16LE(0x12),
      v_active_out2: res.readUInt16LE(0x14),

      unk0: res.readUInt16LE(0x16),
      unk1: res.readUInt16LE(0x18),
      unk2: res.readUInt16LE(0x1a),

      h_front_porch: res.readUInt16LE(0x1c),
      h_sync_pulse: res.readUInt16LE(0x1e),
      h_back_porch: res.readUInt16LE(0x20),
      h_active: res.readUInt16LE(0x22),
      h_total: res.readUInt16LE(0x24),

      v_front_porch: res.readUInt16LE(0x26),
      v_sync_pulse: res.readUInt16LE(0x28),
      v_back_porch: res.readUInt16LE(0x2a),
      v_active: res.readUInt16LE(0x2c),
      v_total: res.readUInt16LE(0x2e)
    };
  }
  // }}}

  // 0x10  0x11  uint8(len)  uint8(pos)   // ??  I2C read from displayport transmitter?
  // read 0x10 0x11/0x71 [len=1, pos=0?], set 0x10 0x10/0x70 [pos=0, byte=0x20], _read_edid_block(0x11/0x71, ...), reset 0x10 0x10/0x70 [pos/byte]
  read_output_edid(output) { // {{{  output = 1/2
    let addr;
    if (output == 1) {
      addr = 0x10;
    } else if (output == 2) {
      addr = 0x70;
    } else {
      throw new Error('bad output');
    }

    // i.e. this._read_dp_tx(output, 0x01, 0x00);  // len, pos
    this._send(0x10, addr + 1, [0x01, 0x00]);  // -> Edid data of output 1   or NACK (not present)    // only if *input* present
    const ores = this._recv();
    if (!ores.ack || ores.data.length !== 1) {
      console.log('read_edid failed (*input* not present?)');
      return false;
    }

    this._send(0x10, addr, [0x00, 0x20]); // set 0x11/0x71 to 0x20 ...   // "enable read to attached display through i2c<->aux bridge"
    if (!this._recv().ack) {
      console.log('read_edid failed (at set address)');
      return false;
    }

//    const res = this._read_block(0xa0, addr + 1, 0x80); // reads only 128 bytes
    const res = this._read_block(0xa0, addr + 1, 0x100, 0x00); // reads 256 bytes ...   // (TODO? in two reads?)
    if (!res) {
      console.log('read_edid failed (output not present?)');

      // try reset
      this._send(0x10, addr, [0x00, ores.data[0]]); // set 0x11 back
      this._recv();
      return false;
    }

    this._send(0x10, addr, [0x00, ores.data[0]]); // set 0x11 back
    if (!this._recv().ack) {
      console.log('read_edid failed (at reset address)');
      // return false;  // (we do have a result ...)
    }

    return res;
  }
  // }}}

  // [0xde  0x31 | 0xa0  0x11/0x71]  uint8(size)  uint8(from)
  _read_block(type, addr, size, from = 0x00) { // {{{
    const ret = [];
    let pos = 0;
    while (pos < size) {
      this._send(type, addr, [Math.min(size - pos, 0x3c), from + pos]); // read max 0x3c(60) bytes from pos
      const res = this._recv();
      if (!res.ack) {
        return false;
      }
      ret.push(res.data);
      pos += res.data.length;
    }
    return Buffer.concat(ret, size);
  }
  // }}}

  // loop write a0 20  uint16_BE(position)  data-bytes  (note: only 32 bytes at a time)
  _write_edid_block(buf) { // {{{
    const type = 0xa0, addr = 0x20, from = 0x00;
    let pos = 0;

    while (pos < size) {
      const len = Math.min(size - pos, 0x20); // write max 0x20(32) bytes at a time
      this._send(type, addr, [(from + pos) & 0xff, ((from + pos) >> 8) & 0xff, ...buf.slice(pos, pos + len)]);

      const res = this._recv();
      if (!res.ack) {
        return false;
      }

      // wait until empty write does not return NACK anymore (according to EEPROM I2C spec)
      for (let i = 0; i < 10; i++) { // max tries: 10
        this._send(type, addr, []);
        const res = this._recv();
        if (res.ack) {
          break;
        }
      }

      pos += len;
    }

    return true;
  }
  // }}}

  _send(type, cmd, data) { // {{{
    if (this.debug) {
      console.log('->', type.toString(16), cmd.toString(16), Buffer.from(data));
    }
    this.dev.write(mkpkt(type, cmd, data));
  }
  // }}}

  _recv() { // {{{
    const buf = this.dev.readTimeout(this._timeout);
    if (!buf.length) {
if (this.debug) console.log(buf);  // TODO?
      return []; // false;  // TODO?
    }
    const ret = parsepkt(buf);
    if (this.debug) {
      if (!ret.ack) {
        console.log('<-', 'NACK', ret.type.toString(16), (ret.cmd & 0x7f).toString(16), ret.data);
      } else {
        console.log('<-', ret.type.toString(16), ret.cmd.toString(16), ret.data);
      }
    }
    return ret;
  }
  // }}}

  // uint8(type)  uint8(addr)  uint8(pos)  uint8(byte)
  _write_byte(type, addr, pos, byte) { // {{{
    this._send(type, addr, [pos & 0xff, byte & 0xff]);
    return !!(this._recv().ack);
  }
  // }}}

  _read_dp_tx(output, size, from = 0x00) { // {{{ output = 1/2
    let addr;
    if (output == 1) {
      addr = 0x11;
    } else if (output == 2) {
      addr = 0x71;
    } else {
      throw new Error('bad output');
    }
    return this._read_block(0x10, addr, size, from);
  }
   // }}}

  _read_dp_tx_video(output) { // {{{
    const buf = this._read_dp_tx(output, 0x0f, 0x10); // size from
    if (buf === false) {
      return false;
    }
    return {
      h_total: buf.readUInt16LE(0x00),
      h_sync_to_next: buf.readUInt16LE(0x02),  // h_sync_pulse + h_back_porch == h_total - h_start
      h_active: buf.readUInt16LE(0x04),

      v_total: buf.readUInt16LE(0x06),
      v_sync_to_next: buf.readUInt16LE(0x08),  // v_sync_pulse + v_back_porch == v_total - v_start
      v_active: buf.readUInt16LE(0x0a),

      _h_sync_pulse: buf[0x0c],   // TODO?
      _v_sync_polarity: (buf[0x0d]&0x80) ? '+' : '-',   // TODO?
      _v_sync_pulse: buf[0x0e],   // TODO?

      _unk0: buf[0x0d]&0x7f
    };
  }
  // }}}

  static list() {
    return HID.devices().filter((d) => {
      if (d.vendorId !== 0x18ea) return false; // not matrox
    //  return true;
      return (d.productId === 0x0009); // DH2GO?
    });
  }
}

module.exports = MatroxGXP;

