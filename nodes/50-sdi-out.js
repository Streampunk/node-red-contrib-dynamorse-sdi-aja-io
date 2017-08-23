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

var ajatation;
try { ajatation = require('ajatation'); } catch (err) { console.log('SDI-Out: ' + err); }
var sdiCommon;
try { sdiCommon = require('./50-sdi-out-common'); } catch (err) { console.log('SDI-Out: ' + err); }

module.exports = function (RED) {

  sdiCommon(RED, ajatation, "sdi-aja-out");
}
