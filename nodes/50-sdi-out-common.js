/* Copyright 2017 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by appl cable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var util = require('util');
var Promise = require('promise');
var Grain = require('node-red-contrib-dynamorse-core').Grain;

const BMDOutputFrameCompleted = 0;
const BMDOutputFrameDisplayedLate = 1;
const BMDOutputFrameDropped = 2;
const BMDOutputFrameFlushed = 3;


module.exports = function (RED, sdiOutput, nodeName) {

  function SDIOut (config) {
    RED.nodes.createNode(this, config);
    redioactive.Spout.call(this, config);

    this.srcFlow = null;
    var sentCount = 0;
    var playedCount = 0;
    var playback = null;
    var node = this;
    var begin = null;
    var playState = BMDOutputFrameCompleted;
    var producingEnough = true;
    var frameCount = 0;

    this.each((x, next) => {
      if (!Grain.isGrain(x)) {
        node.warn('Received non-Grain payload: ' + JSON.stringify(x));
        return next();
      }

      var nextJob = (node.srcFlow) ?
        Promise.resolve(x) :
        (Promise.denodeify(node.getNMOSFlow, 1))(x)
        .then(f => {
          node.srcFlow = f;
          if (f.tags.format[0] !== 'video') {
            return node.preFlightError('Only video sources supported for SDI out.');
          }
          // Set defaults to the most commonly format for dynamorse testing
          // TODO: support for DCI modes
          var bmMode = sdiOutput.bmdModeHD1080i50;
          var bmFormat = sdiOutput.bmdFormat10BitYUV;
          switch (+f.tags.height[0]) {
            case 2160:
              switch (x.getDuration()[1]) {
                case 25:
                case 25000:
                  bmMode = sdiOutput.bmdMode4K2160p25;
                  break;
                case 24:
                case 24000:
                  bmMode = (x.getDuration()[0] === 1001) ?
                    sdiOutput.bmdMode4K2160p2398 : sdiOutput.bmdMode4K2160p24;
                  break;
                case 30:
                case 30000:
                  bmMode = (x.getDuration()[0] === 1001) ?
                    sdiOutput.bmdMode4K2160p2997 : sdiOutput.bmdMode4K2160p30;
                  break;
                case 50:
                case 50000:
                  bmMode = sdiOutput.bmdMode4K2160p50;
                  break;
                case 60:
                case 60000:
                  bmMode = (x.getDuration()[0] === 1001) ?
                    sdiOutput.bmdMode4K2160p5994 : sdiOutput.bmdMode4k2160p60;
                  break;
                default:
                  node.preFlightError('Could not establish device mode.');
                  break;
              }
              break;
            case 1080:
              switch (x.getDuration()[1]) {
                case 25:
                case 25000:
                  bmMode = (f.tags.interlace[0] === '1') ?
                    sdiOutput.bmdModeHD1080i50 : sdiOutput.bmdModeHD1080p25;
                    break;
                case 24:
                case 24000:
                  if (x.getDuration()[0] === 1001) {
                    bmMode = (f.tags.interlace[0] === '1') ?
                      sdiOutput.bmdModeHD1080i5994 : sdiOutput.bmdModeHD1080p2398;
                  } else {
                    bmMode = sdiOutput.bmdModeHD1080p24;
                  }
                  break;
                case 30:
                case 30000:
                  if (x.getDuration()[0] === 1001) {
                    bmMode = (f.tags.interlace[0] === '1') ?
                      sdiOutput.bmdModeHD1080i5994 : sdiOutput.bmdModeHD1080p2997;
                  } else {
                    bmMode = (f.tags.interlace[0] === '1') ?
                      sdiOutput.bmdModeHD1080i6000 : sdiOutput.bmdModeHD1080p30;
                  }
                  break;
                case 50:
                case 50000:
                  bmMode = sdiOutput.bmdModeHD1080p50;
                  break;
                case 60:
                case 60000:
                  bmMode = (x.getDuration()[0] === 1001) ?
                    sdiOutput.bmdModeHD1080p5994 : sdiOutput.bmdModeHD1080p6000;
                  break;
                default:
                  node.preFlightError('Could not establish device mode.');
                  break;
              }
              break;
            case 720:
              switch (x.getDuration()[1]) {
                case 50:
                case 50000:
                  bmMode = sdiOutput.bmdModeHD720p50;
                  break;
                case 60:
                case 60000:
                  bmMode = (x.getDuration()[0] === '1') ?
                    sdiOutput.bmdModeHD720p5994 : sdiOutput.bmdModeHD720p60;
                  break;
                default:
                  node.preFlightError('Could not establish device mode.');
                  break;
              }
              break;
            case 576:
              switch (x.getDuration()[1]) {
                case 25:
                case 25000:
                  bmMode = bmdModePAL;
                  break;
                case 50:
                case 50000:
                  bmMode = bmcModePALp;
                  break;
                default:
                  node.preFlightError('Could not establish device mode.');
                  break;
              }
              break;
            case 486:
              switch (x.getDuration()[1]) {
                case 30:
                case 30000:
                  bmMode = bmdModeNTSC;
                  break;
                case 60:
                case 60000:
                  bmMode = bmdModeNTSCp;
                  break;
                default:
                  node.preFlightError('Could not establish device mode.');
                  break;
              }
              break;
            default:
                node.preFlightError('Could not establish device mode.');
              break;
          }
          if (f.tags.packing && f.tags.packing.length >= 1)
          {
            var newFormat = sdiOutput.fourCCFormat(f.tags.packing[0]);
            this.warn("NOTE: Aja Output Switching pixel format from " + sdiOutput.intToBMCode(bmFormat) + " to " + sdiOutput.intToBMCode(newFormat));
            bmFormat = sdiOutput.fourCCFormat(f.tags.packing[0]);
          }
          this.log("NOTE: Initializing Aja Output to Display Mode " + sdiOutput.intToBMCode(bmMode));
          playback = new sdiOutput.Playback(config.deviceIndex,
            bmMode, bmFormat);
          playback.on('error', e => {
            node.warn(`Received playback error from Aja card: ${e}`);
            next();
          });

          begin = process.hrtime();
          return x;
        });
      nextJob.then(g => {
          //node.log('Received Frame number: ' + ++frameCount);

        playback.frame(g.buffers[0]);
        sentCount++;
        if (sentCount === +config.frameCache) {
          this.log('Starting playback.');
          playback.start();
          playback.on('played', p => {
            playedCount++;
            if (p !== playState) {
              playState = p;
              switch (playState) {
                case BMDOutputFrameCompleted:
                  this.warn(`After ${playedCount} frames, playback state returned to frame completed OK.`);
                  break;
                case BMDOutputFrameDisplayedLate:
                  this.warn(`After ${playedCount} frames, playback state is now displaying frames late.`);
                  break;
                case BMDOutputFrameDropped:
                  this.warn(`After ${playedCount} frames, playback state is dropping frames.`);
                  break;
                case BMDOutputFrameFlushed:
                  this.warn(`After ${playedCount} frames, playback state is flushing frames.`);
                  break;
                default:
                  this.error(`After ${playedCount} frames, playback state is unknown, code ${playState}.`);
                  break;
              }
            }
          });
        }
        var diffTime = process.hrtime(begin);
        var diff = (sentCount * config.timeout) -
            (diffTime[0] * 1000 + diffTime[1] / 1000000|0);
        if ((diff < 0) && (producingEnough === true)) {
          this.warn(`After sending ${sentCount} frames and playing ${playedCount}, not producing frames fast enough for SDI output.`);
          producingEnough = false;
        }
        if ((diff > 0) && (producingEnough === false)) {
          this.warn(`After sending ${sentCount} frames and playing ${playedCount}, started producing enough frames fast enough for SDI output.`);
          producingEnough = true;
        }
        setTimeout(next, (diff > 0) ? diff : 0);
        // if (sentCount < +config.frameCache) {
        //   node.log(`Caching frame ${sentCount}/${typeof config.frameCache}.`);
        //   playback.frame(g.buffers[0]);
        //   sentCount++;
        //   if (sentCount === +config.frameCache) {
        //     node.log('Starting playback.');
        //     playback.start();
        //     playback.on('played', p => {
        //       playedCount++;
        //       next(); next();
        //       if (p > 0) { console.error('XXX'); next(); }
        //     });
        //   }
        //   next();
        // } else {
        //   // console.log(`next frame ${sentCount}.`);
        //   playback.frame(g.buffers[0]);
        //   sentCount++;
        // };
      })
      .catch(err => {
        node.error(`Failed to play video on device '${config.deviceIndex}': ${err}`);
      });
    });

    node.errors((e, next) => {
      node.warn(`Received unhandled error: ${e.message}.`);
      setImmediate(next);
    });
    node.done(() => {
      node.log('No more to see here!');
      playback.stop();
    });
    node.close(() => {
      node.log('Closing the video - too bright!');
      playback.stop();
    });
    process.on('exit', () => {
      if (playback) playback.stop();
    });
    process.on('SIGINT', () => {
      if (playback) playback.stop();
    });
  }
  util.inherits(SDIOut, redioactive.Spout);
  RED.nodes.registerType(nodeName, SDIOut);
}
