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
var Grain = require('node-red-contrib-dynamorse-core').Grain;
var uuid = require('uuid');

try { logUtils = require('./log-utils'); } catch (err) { console.log('logUtils: ' + err); }

const BMDOutputFrameCompleted = 0;
const BMDOutputFrameDisplayedLate = 1;
const BMDOutputFrameDropped = 2;
const BMDOutputFrameFlushed = 3;

const OPTIMUM_BUFFER_SIZE = 5;


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


function extractVersions (v) {
  var m = v.match(/^([0-9]+):([0-9]+)$/);
  if (m === null) { return [Number.MAX_SAFE_INTEGER, 0]; }
  return [+m[1], +m[2]];
}

function compareVersions (l, r) {
  var lm = extractVersions(l);
  var rm = extractVersions(r);
  if (lm[0] < rm[0]) return -1;
  if (lm[0] > rm[0]) return 1;
  if (lm[1] < rm[1]) return -1;
  if (lm[1] > rm[1]) return 1;
  return 0;
}

module.exports = function (RED, sdiOutput, nodeName) {

  // Extensive pipeline logging is disabled by default. Uncommenting the
  // statement below outputs pipline statistics allowing grain movement
  // to be tracked and measured for latency and smoothness
  //logUtils.EnableLogging();

  function SDIOut (config) {
    RED.nodes.createNode(this, config);
    redioactive.Spout.call(this, config);

    var deviceSdkVersion = sdiOutput.deviceVersion();
    var deviceIndex = sdiOutput.getFirstDevice();

    console.info(`initializing Aja card. ${deviceSdkVersion}; first device = ${deviceIndex}`)

    this.srcFlow = null;
    var sentCount = 0;
    var playedCount = 0;
    var playback = null;
    var node = this;
    var begin = null;
    var playState = BMDOutputFrameCompleted;
    var producingEnough = true;
    var vidSrcFlowID = null;
    var audSrcFlowID = null;

    function MatchingTimestamps(ts1, ts2) {
      if(ts1[0] == ts2[0] && ts1[1] == ts2[1]) return true;
      else return false;
    }

    //var cachedGrain = { grain: null, isVideo: false };  
    //function TryGetCachedGrain(grain, isVideo) {
    //  logUtils.LogPlaybackGrain(grain, isVideo); // TEST
    //
    //  if(cachedGrain.grain != null && cachedGrain.isVideo != isVideo && MatchingTimestamps(cachedGrain.grain.getOriginTimestamp(), grain.getOriginTimestamp()))
    //  {
    //    var toReturn = cachedGrain.grain;
    //    cachedGrain.grain = null;
    //    //node.log('Found grain match, cached grain: ' + toReturn.getOriginTimestamp());
    //
    //    return toReturn;
    //  }
    //  else
    //  {
    //    if(cachedGrain.grain != null)
    //    {
    //      //node.warn('!!WARNING!! Discarding expired cached grain: ' + (cachedGrain.isVideo ? 'v' : 'a') + '-' + GetGrainSequence(cachedGrain.grain));
    //      logUtils.LogAnomaly('Discarding expired cached grain: ' + (cachedGrain.isVideo ? 'v' : 'a') + '; cached timecode: ' + cachedGrain.grain.getOriginTimestamp()[1] + '; current timecode: ' + grain.getOriginTimestamp()[1]);
    //    }
    //    cachedGrain.grain = grain;
    //    cachedGrain.isVideo = isVideo;
    //
    //    return null;
    //  }
    //}

    var grainCache = {};

    function tryGetCachedGrain (grain, type) { // TODO change to fuzzy match
      let timestamp = grain.formatTimestamp(grain.ptpOrigin);
      let cachedGrain = grainCache[timestamp];
      if (cachedGrain) {
        if (cachedGrain.type !== type) { // TODO consider other grain types
          delete grainCache[timestamp];
          return cachedGrain.grain;
        } else {
          logUtils.LogAnomaly(`For timestamp ${timestamp}, received two grains of the same type ${type}.`);
        }
      } else {
        grainCache[timestamp] = { grain: grain, type: type };
        return null;
      }
    }

    var clearDown = setInterval(() => {
      let grainKeys = Object.keys(grainCache);
      node.log(`Clearing down grain cache of size ${grainKeys.length}.`);
      let ditch = grainKeys.sort(compareVersions).slice(0, -10);
      ditch.forEach(x => {
        logUtils.LogAnomaly(`For timestamp ${x}, grain of type ${grainCache[x].type} was not matched. Discarding.`);
        delete grainCache[x];
      });
    }, 5000);

    this.each((x, next) => {
      if (!Grain.isGrain(x)) {
        node.warn('Received non-Grain payload: ' + JSON.stringify(x));
        return next();
      }

      var nextJob = (node.srcFlow) ?
        Promise.resolve(x) :
        this.findCable(x)
        .then(c => {
          var fv = c[0].video[0];
          node.srcFlow = fv;
          node.vidSrcFlowID = fv.flowID;

          if (fv.tags.format !== 'video') {
            return node.preFlightError('Only video sources supported for SDI out.');
          }

          var fa = (Array.isArray(c[0].audio) && c[0].audio.length > 0) ? c[0].audio[0] : null;

          if(fa != null) {
            node.log('We have audio: ' + JSON.stringify(c[0].audio));
            node.audSrcFlowID = fa.flowID;
          }

          // Set defaults to the most commonly format for dynamorse testing
          // TODO: support for DCI modes
          var bmMode = sdiOutput.bmdModeHD1080i50;
          var bmFormat = sdiOutput.bmdFormat10BitYUV;

          frameDurationMs = (x.getDuration()[0] * 1000) / x.getDuration()[1]
          node.log('Current frame duration in milliseconds = ' + frameDurationMs);

          console.log("Playback Video Tags: " + JSON.stringify(fv.tags));

          switch (fv.tags.height) {
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
                  node.preFlightError('Could not establish device mode; height = ' + fv.tags.height + '; duration = ' + x.getDuration()[0] + '/' + x.getDuration()[1]);
                  break;
              }
              break;
            case 1080:
              switch (x.getDuration()[1]) {
                case 25:
                case 25000:
                  bmMode = (fv.tags.interlace === true) ?
                    sdiOutput.bmdModeHD1080i50 : sdiOutput.bmdModeHD1080p25;
                    break;
                case 24:
                case 24000:
                  if (x.getDuration()[0] === 1001) {
                    bmMode = (fv.tags.interlace === true) ?
                      sdiOutput.bmdModeHD1080i5994 : sdiOutput.bmdModeHD1080p2398;
                  } else {
                    bmMode = sdiOutput.bmdModeHD1080p24;
                  }
                  break;
                case 30:
                case 30000:
                  if (x.getDuration()[0] === 1001) {
                    bmMode = (fv.tags.interlace === true) ?
                      sdiOutput.bmdModeHD1080i5994 : sdiOutput.bmdModeHD1080p2997;
                  } else {
                    bmMode = (fv.tags.interlace === true) ?
                      sdiOutput.bmdModeHD1080i6000 : sdiOutput.bmdModeHD1080p30;
                  }
                  break;
                case 50:
                case 50000:
                  bmMode = sdiOutput.bmdModeHD1080p50;
                  break;
                case 60:
                case 60000:
                  if (x.getDuration()[0] === 1001) {
                    bmMode = (fv.tags.interlace === true) ?
                      sdiOutput.bmdModeHD1080i5994 : sdiOutput.bmdModeHD1080p5994;
                  } else {
                    bmMode = (fv.tags.interlace === true) ?
                      sdiOutput.bmdModeHD1080i6000 : sdiOutput.bmdModeHD1080p6000;
                  }
                  break;
                default:
                  node.preFlightError('Could not establish device mode; height = ' + fv.tags.height + '; duration = ' + x.getDuration()[0] + '/' + x.getDuration()[1]);
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
                  node.preFlightError('Could not establish device mode; height = ' + fv.tags.height + '; duration = ' + x.getDuration()[0] + '/' + x.getDuration()[1]);
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
                  node.preFlightError('Could not establish device mode; height = ' + fv.tags.height + '; duration = ' + x.getDuration()[0] + '/' + x.getDuration()[1]);
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
                  node.preFlightError('Could not establish device mode; height = ' + fv.tags.height + '; duration = ' + x.getDuration()[0] + '/' + x.getDuration()[1]);
                  break;
              }
              break;
            default:
              node.preFlightError('Could not establish device mode; height = ' + fv.tags.height + '; duration = ' + x.getDuration()[0] + '/' + x.getDuration()[1]);
              break;
          }

          if (fv.tags.packing)
          {
            bmFormat = sdiOutput.fourCCFormat(fv.tags.packing);
          }
          this.log("NOTE: Initializing Aja Output to Display Mode " + sdiOutput.intToBMCode(bmMode));
          playback = new sdiOutput.Playback(
            ensureInt(config.deviceIndex),
            ensureInt(config.channelNumber),
            bmMode, 
            bmFormat);
          playback.on('error', e => {
            node.warn(`Received playback error from Aja card: ${e}`);
            next();
          });

          begin = process.hrtime();
          return x;
        });
      nextJob.then(g => {

        var flowId = uuid.unparse(g.flow_id);
        var videoGrain = null;
        var audioGrain = null;

        //console.log("** FlowId ******************************: " + flowId);
        if (flowId === node.vidSrcFlowID) {
          if(node.audSrcFlowID == null) {
            videoGrain = g;
          }
          else
          {
            audioGrain = tryGetCachedGrain(g, 'audio');

            if(audioGrain) 
            {
              videoGrain = g;
            }
          }
        } else if(flowId === node.audSrcFlowID) {
          videoGrain = tryGetCachedGrain(g, 'video');

          if(videoGrain)
          {
            audioGrain = g;
          }
        } else {
          return next();
        }

        if(videoGrain != null)
        {
            var usedBuffers = 0;
          
            if(audioGrain) {
                //logUtils.WriteTestBuffer(audioGrain.buffers[0], ensureInt(config.deviceIndex), ensureInt(config.channelNumber));
                usedBuffers = playback.frame(videoGrain.buffers[0], audioGrain.buffers[0]);
            }
            else {
                usedBuffers = playback.frame(videoGrain.buffers[0]);
              }

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

            var diff = 0;

            if(usedBuffers > OPTIMUM_BUFFER_SIZE) // 5 currently arbitrary number, make this tuneable
            {
              diff = Math.min((usedBuffers - OPTIMUM_BUFFER_SIZE), 3) * frameDurationMs;
              //diff = frameDurationMs;
            }

            //this.log(">> UsedBuffer = " + usedBuffers + "; delay = " + diff);
            
            if ((diff < 0) && (producingEnough === true)) {
              this.warn(`After sending ${sentCount} frames and playing ${playedCount}, not producing frames fast enough for SDI output.`);
              producingEnough = false;
            }
            if ((diff > 0) && (producingEnough === false)) {
              this.warn(`After sending ${sentCount} frames and playing ${playedCount}, started producing enough frames fast enough for SDI output.`);
              producingEnough = true;
            }

            //setTimeout(next, 0);
            setTimeout(next, (diff > 0) ? diff : 0);
        }
        else
        {
            setTimeout(next, 0);
        }
      })
      .catch(err => {
        node.error(`Failed to play video on device '${config.deviceIndex}': ${err}; ${err.stack}`);
      });
    });

    node.errors((e, next) => {
      node.warn(`Received unhandled error: ${e.message}.`);
      setImmediate(next);
    });
    node.done(() => {
      node.log('No more to see here!');
      playback.stop();
      clearInterval(clearDown);
    });
    node.on('close', () => {
      node.log('Closing the video - too bright!');
      playback.stop();
    });
    process.on('exit', () => {
      if (playback) playback.stop();
    });
    process.on('SIGINT', () => {
      if (playback) playback.stop();
      process.exit();
    });
  }
  util.inherits(SDIOut, redioactive.Spout);
  RED.nodes.registerType(nodeName, SDIOut);
}
