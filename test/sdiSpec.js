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

var sdiIn = require('../nodes/50-sdi-in.js');
var sdiOut = require('../nodes/50-sdi-out.js');
var test = require('tape');

test('Modules load OK', t => {
  t.ok(sdiIn, 'SDI in loads OK.');
  t.ok(sdiOut, 'SDI out loads OK.');
  t.end();
});
