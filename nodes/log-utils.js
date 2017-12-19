
// TEST-BEGIN Cache Monitor
var grainMap = new Map();
var grainList = [];
var grainCounter = 0;
var aTotalSentCount = 0;
var vTotalSentCount = 0;
var aTotalRecvCount = 0;
var vTotalRecvCount = 0;

var initialized = false;
var logFilename = null;
var startTime = null;
var loggingEnabled = false;

const fs = require('fs');

function LogCaptureGrain(grain, isVideo) {
    LogGrain(true, grain, isVideo)
}

function LogPlaybackGrain(grain, isVideo) {
    LogGrain(false, grain, isVideo)
}

function Initialize() 
{
    startTime = Date.now();

    var now = new Date()
    var timestamp = now.toISOString().replace(/:/g, "_");
    logFilename = "grain-counts-" + timestamp + ".csv";

    fs.appendFileSync(logFilename, "Timestamp, VideoSent, AudioSent, VideoReceived, AudioReceived, originalTimeStamp, totalVideoSent, totalAudioSent, totalVideoRcvr, totalAudioRcvd, anomaly,\r\n");
}

function GetFilename()
{
    if(logFilename == null)
    {
        Initialize();
    }

    return logFilename;
}

function WriteLog(entry)
{
    var filename = GetFilename();
    var timeDiff = Date.now() - startTime;
    
    var logString = timeDiff + ", " + entry + "\r\n";

    fs.appendFileSync(filename, logString);
}

function EnableLogging(enable = true) 
{
    loggingEnabled = enable;
}

function LogAnomaly(info)
{
    if(loggingEnabled)
    {
        var entryString = ", , , , , , , , , " + info + ",";
        WriteLog(entryString);
    }

    console.warn(entry);
}

function LogGrain(isCapture, grain, isVideo) 
{
    if(loggingEnabled)
    {
        var timestamp = grain.getOriginTimestamp();
        var tsString = timestamp[0].toString() + timestamp[1].toString();

        var sequence = grainMap.get(tsString);

        if(sequence === undefined)
        {
            sequence = ++grainCounter;
            grainMap.set(tsString, sequence);
        }

        //"Timestamp, VideoSent, AudioSent, VideoReceived, AudioReceived, originalTimeStamp, totalVideoSent, totalAudioSent, totalVideoRcvr, totalAudioRcvd, anomaly"
        var entryString = null;

        if(isCapture == true) 
        {
            if(isVideo == true) 
            {
                entryString = sequence + ", , , , "
                vTotalSentCount++;
            } 
            else 
            {
                entryString = ", " + sequence + ", , , "
                aTotalSentCount++;
            }
        }
        else
        {
            if(isVideo == true) 
            {
                entryString = ", , " + sequence + ", , "
                vTotalRecvCount++;
            } 
            else 
            {
                entryString = ", , , " + sequence + ", "
                aTotalRecvCount++;
            }
        }

        entryString += timestamp[1];
        entryString += ", ";
        entryString += vTotalSentCount;
        entryString += ", ";
        entryString += aTotalSentCount;
        entryString += ", ";
        entryString += vTotalRecvCount;
        entryString += ", ";
        entryString += aTotalRecvCount;
        entryString += ", ,";

        WriteLog(entryString);

        if(grainMap.size > 20000)
        {
            grainMap.clear();
        }
    }
}

function GetGrainSequence(grain) {
    var timestamp = grain.getOriginTimestamp();
    var tsString = timestamp[0].toString() + timestamp[1].toString();

    return grainMap.get(tsString);
}

function WriteTestBuffer(buffer, deviceId, channel)
{
  var filename = `test_aja_in_${deviceId}_${channel}.dat`;
  output = fs.appendFile(filename, buffer, 'binary');
}

var logUtils = {
    LogCaptureGrain: LogCaptureGrain,
    LogPlaybackGrain: LogPlaybackGrain,
    LogAnomaly: LogAnomaly,
    EnableLogging: EnableLogging,
    WriteTestBuffer: WriteTestBuffer
};

module.exports = logUtils;