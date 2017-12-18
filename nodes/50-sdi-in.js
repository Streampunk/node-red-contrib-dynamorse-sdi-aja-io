/* Copyright 2017 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var util = require('util');
var ajatation;
try { ajatation = require('ajatation'); } catch(err) { console.log('SDI-Aja-In: ' + err); }
try { logUtils = require('./log-utils'); } catch (err) { console.log('logUtils: ' + err); }

var Grain = require('node-red-contrib-dynamorse-core').Grain;

function fixBMDCodes(code) {
  if (code === 'ARGB') return 32;
  return ajatation.bmCodeToInt(code);
}

//const fs = require('fs');
//function TEST_write_buffer(buffer, deviceId, channel) {
//  var filename = `c:\\users\\zztop\\music\\test_aja_in_${deviceId}_${channel}.dat`;
//  output = fs.appendFile(filename, buffer, 'binary');
//}

function ensureInt(value) {
  if(typeof value === 'number')
  {
    return value;
  }
  else
  {
    return parseInt(value)
  }
}

module.exports = function (RED) {
  function SDIIn (config) {
    RED.nodes.createNode(this,config);
    redioactive.Funnel.call(this, config);

    if (!this.context().global.get('updated'))
      return this.log('Waiting for global context updated.');

    var capture = new ajatation.Capture(
      ensureInt(config.deviceIndex), 
      ensureInt(config.channelNumber),
      fixBMDCodes(config.mode), 
      fixBMDCodes(config.format));

    var actualMode = ajatation.intToBMCode(capture.getVideoFormat());

    if(actualMode != config.mode)
    {
      console.warn("Input Video Format (" + actualMode + ") does not match configuration(" + config.mode + ") - reconfiguring");
    }

    var node = this;
    var frameCount = 0;
    var grainDuration = ajatation.modeGrainDuration(fixBMDCodes(actualMode));

    capture.enableAudio(0,0,0);

    this.vtags = {
      format : 'video',
      encodingName : 'raw',
      width : ajatation.modeWidth(fixBMDCodes(actualMode)),
      height : ajatation.modeHeight(fixBMDCodes(actualMode)),
      depth : ajatation.formatDepth(fixBMDCodes(config.format)),
      packing : ajatation.formatFourCC(fixBMDCodes(config.format)),
      sampling : ajatation.formatSampling(fixBMDCodes(config.format)),
      clockRate : 90000,
      interlace : ajatation.modeInterlace(fixBMDCodes(actualMode)),
      colorimetry : ajatation.formatColorimetry(fixBMDCodes(config.format)),
      grainDuration : grainDuration
    };
    this.atags = {
      format: 'audio',
      encodingName: 'L24',
      clockRate: 48000,
      channels: 2,
      blockAlign: 6,
      grainDuration: grainDuration
    };
    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];
    var cable = { video: [ { tags: this.vtags } ], backPressure: "video[0]" };
    if (config.audio === true)
      cable.audio = [ { tags: this.atags } ];
    this.makeCable(cable);

    var ids = {
      vFlowID: this.flowID('video[0]'),
      vSourceID: this.sourceID('video[0]'),
      aFlowID: (config.audio === true) ? this.flowID('audio[0]') : undefined,
      aSourceID: (config.audio === true) ? this.sourceID('audio[0]') : undefined
    };

    console.log(`Capture Video Tags: `, JSON.stringify(this.vtags));
    console.log(`You wanted audio?`, ids);

    this.eventMuncher(capture, 'frame', (video, audio) => {
      //node.log('Received Frame number: ' + ++frameCount);
      //TEST_write_buffer(audio, ensureInt(config.deviceIndex), ensureInt(config.channelNumber));

      //console.log('Event munching', video.length, audio ? audio.length : "no_audio");
      var grainTime = Buffer.allocUnsafe(10);
      grainTime.writeUIntBE(this.baseTime[0], 0, 6);
      grainTime.writeUInt32BE(this.baseTime[1], 6);
      this.baseTime[1] = ( this.baseTime[1] +
        grainDuration[0] * 1000000000 / grainDuration[1]|0 );
      this.baseTime = [ this.baseTime[0] + this.baseTime[1] / 1000000000|0,
        this.baseTime[1] % 1000000000];
      var va = [ new Grain([video], grainTime, grainTime, null,
        ids.vFlowID, ids.vSourceID, grainDuration) ]; // TODO Timecode support
      logUtils.LogCaptureGrain(va[0], true); // TEST

      if (config.audio === true && audio) { 
        va.push( new Grain([audio], grainTime, grainTime, null,
          ids.aFlowID, ids.aSourceID, grainDuration));
        logUtils.LogCaptureGrain(va[1], false); // TEST
      } else if (config.audio === true) {
        console.warn('!! WARNING: Missing audio sample on input !!');
      }

      return va;
    });

    capture.on('error', e => {
      this.push(e);
    });

    this.on('close', () => {
      this.close();
      capture.stop();
    });

    capture.start();
  }
  util.inherits(SDIIn, redioactive.Funnel);
  RED.nodes.registerType("sdi-aja-in", SDIIn);
}
