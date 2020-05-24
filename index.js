require('dotenv').config();
const request = require('request');
const fs = require('fs');
const { GraphQLClient } = require('graphql-request');

const userMail = process.env.USERMAIL;
const userName = process.env.USERNAME;
const userPw = process.env.USERPW;
const backendLocation = process.env.BACKENDLOCATION;
const cacheUpdateInterval = process.env.CACHEUPDATEINTERVAL; // in seconds
const camRequestInterval = process.env.CAMREQUESTINTERVAL; // in seconds
const backOffInterval = process.env.BACKOFFINTERVAL; // in seconds
const mediaSourcesAddresses = process.env.MEDIASOURCESADDRESSES;

var graphQLClient = new GraphQLClient(backendLocation);
var authToken = ''; // needed for the image upload, since it uses a different uploader client
var activeMediaStreamsCache = {}; // holds a list of active media streams from server
var lastCacheUpdateTimeStamp = null; // last update of cache
var mediaSources = {};

main();

async function main() {
  // startup process
  console.log('Startup...');
  // login or register input user
  await loginOrRegister();
  // populate the initial active media streams cache
  await updateMediaStreamsCache();
  // start media retrieval process
  mediaSourcesAddresses.split(',').forEach(source => {
    source = source.split(':');
    console.log('Setup source at ' + source[1] + '..');
    let mediaSource = { sourceAddress: source[1], lastTimeStamp: 0, lastError: 0};
    mediaSources[source[0]] = mediaSource;
    setInterval(uploadImage, camRequestInterval * 1000, source[0]);
  });
  console.log(`Setup cache update with ${cacheUpdateInterval}s interval..`);
  setInterval(updateMediaStreamsCache, cacheUpdateInterval * 1000);

  console.log('Startup done!');
}

async function uploadImage(mediaFilesName) {
  // check if media stream exists
  let mediaStream = null;
  for (let i = 0; i < activeMediaStreamsCache.length; i++) {
    if (activeMediaStreamsCache[i].mediaFilesName === mediaFilesName) {
      // found it
      mediaStream = activeMediaStreamsCache[i];
      break;
    }
  }
  if (!mediaStream) return; // no active stream exists for this file name

  // check if update is too recent or error
  if (new Date() - mediaSources[mediaFilesName].lastTimeStamp <
    mediaStream.updateFrequency * 1000
    ||
    new Date() - mediaSources[mediaFilesName].lastError <
    backOffInterval * 1000
  ) {
    return;
  }

  // temporary cache the last time stamp to reset it if needed
  let oldLastTimeStampMainView = mediaSources[mediaFilesName].lastTimeStamp;
  mediaSources[mediaFilesName].lastTimeStamp = new Date();

  request('http://' + mediaSources[mediaFilesName].sourceAddress, {timeout: mediaStream.updateFrequency * 1000})
    .on('error', function(err) {
      console.log(`Stream request error for ${mediaFilesName}: ${err}`);
      mediaSources[mediaFilesName].lastTimeStamp = oldLastTimeStampMainView;
      mediaSources[mediaFilesName].lastError = new Date();
      return;
    }).pipe(
      fs.createWriteStream(`${mediaFilesName}.jpg`)
        .on('error', function(err){
          console.log(`Stream write error for ${mediaFilesName}: ${err}`);
          mediaSources[mediaFilesName].lastTimeStamp = oldLastTimeStampMainView;
          mediaSources[mediaFilesName].lastError = new Date();
          return;
        })
    ).on('close', function() {
      let formData = {
        mediaStreamName: 'mainView',
        mediaMimeType: 'IMAGE_JPG',
        mediaTimestamp: mediaSources[mediaFilesName].lastTimeStamp.toJSON(),
        mediaData: fs.createReadStream(`${mediaFilesName}.jpg`),
      };
      request.post({
        url: `${backendLocation}/uploadMedia`,
        headers: {
          'Authorization': 'Bearer ' + authToken
        },
        formData: formData
      }, function callback(err, httpResponse, identifier) {
        if (err) {
          mediaSources[mediaFilesName].lastTimeStamp = oldLastTimeStampMainView;
          mediaSources[mediaFilesName].lastError = new Date();
          console.log(`Failed upload for ${mediaFilesName}: ${err}`);
        } else{
        // TODO: check, if data was acutally stored on server, only correct upload is checked for here
          console.log(`File for ${mediaFilesName} send, server returned identifier: ${identifier}`);
        }
      });
    });
}

async function loginOrRegister() {
  console.log('Login user...');
  let mutation = /* GraphQL */ `
    mutation signin($email: String!, $password: String!) {
      signin(email: $email, password: $password) {
        token
      }
    }
  `;
  let variables = {
    email: userMail,
    password: userPw
  };
  try {
    let data = await graphQLClient.request(mutation, variables);
    authToken = data.signin.token;
    graphQLClient = new GraphQLClient(backendLocation, {
      headers: {
        Authorization: 'Bearer ' + authToken
      }
    });
    console.log('Logged in!');
  } catch (e) {
    console.log('Login not possible, trying to register new user...');

    mutation = /* GraphQL */ `
      mutation signup($name: String!, $password: String!, $email: String!) {
        signup(name: $name, password: $password, email: $email) {
          token
        }
      }
    `;
    variables = {
      name: userName,
      password: userPw,
      email: userMail
    };
    try {
      let data = await graphQLClient.request(mutation, variables);
      authToken = data.signin.token;
      graphQLClient = new GraphQLClient(backendLocation, {
        headers: {
          Authorization: 'Bearer ' + authToken
        }
      });
      console.log('Registered new user!');
    } catch (e) {
      // No login and signup possible...
      console.log(e);
      process.exit(1);
    }
  }
}

async function updateMediaStreamsCache() {
  // temporary cache the "old" last time stamp in case of failure with updating
  let oldLastCacheUpdateTimeStamp = lastCacheUpdateTimeStamp;
  lastCacheUpdateTimeStamp = new Date();
  let query = /* GraphQL */ `
    {
      mediaStreams(active: true) {
        id
        mediaFilesName
        updateFrequency
        brewingProcess {
          id
        }
      }
    }
  `;
  try {
    let data = await graphQLClient.request(query);
    // a bit of data flattening
    for (let i = 0; i < data.mediaStreams.length; i++) {
      data.mediaStreams[i].brewingProcess =
        data.mediaStreams[i].brewingProcess.id;
    }
    activeMediaStreamsCache = data.mediaStreams;
    console.log(`Updated cache at: ${lastCacheUpdateTimeStamp}`);
  } catch (e) {
    // "reset" timestamp
    lastCacheUpdateTimeStamp = oldLastCacheUpdateTimeStamp;
    console.log(`Error, cache not updated: ${e}`);
  }
}
