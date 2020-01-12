const request = require('request');
const fs = require('fs');

const { GraphQLClient } = require('graphql-request');
const MjpegDecoder = require('mjpeg-decoder');

const userMail = 'InputUser';
const userName = 'InputUser';
const userPw = 'Ewi_g9fTD}Nr%Xj@';
//const backendLocation = 'https://api.indebrau.de';
const backendLocation = 'http://localhost:4000';
const cacheUpdateInterval = 10; // in seconds
const camRequestInterval = 1; // in seconds

var graphQLClient = new GraphQLClient(backendLocation);
var authToken = ''; // needed for the image upload, since it uses different uploader client
var activeMediaStreamsCache = {}; // holds a list of active media streams
var lastCacheUpdateTimeStamp = null; // last update of cache

const mainViewDecoder = new MjpegDecoder(
  'http://192.168.178.32/', { interval: camRequestInterval * 1000 }
);
var lastTimeStampMainView = new Date();

async function main() {
  // startup process
  console.log('Startup...');
  // login or register input user
  await loginOrRegister();
  // populate the initial active media streams cache
  await updateMediaStreamsCache();
  console.log('Started!');
  // finished startup, now start media decoders
  mainViewDecoder.start();
}

main();

mainViewDecoder.on('frame', (frame) => {
  if (new Date() - lastCacheUpdateTimeStamp > cacheUpdateInterval * 1000) {
    // don't wait for this, might result in 1-2 seconds delayed update (and multiple updates),
    // which is ok (in comparison to pausing the media processing)
    updateMediaStreamsCache();
  }
  let mainViewMediaStream = null; // first set to null...
  for (let i = 0; i < activeMediaStreamsCache.length; i++) {
    if (activeMediaStreamsCache[i].mediaFilesName === 'mainView') {
      // found it
      mainViewMediaStream = activeMediaStreamsCache[i];
      break;
    }
  }
  if (!mainViewMediaStream) return; // no active stream exists
  // check if update is too recent
  if (new Date() - lastTimeStampMainView >
    mainViewMediaStream.updateFrequency * 1000
  ) {
    // if not, upload...
    // temporary cache the "old" last time stamp in case of failure with upload
    let oldLastTimeStampMainView = lastTimeStampMainView;
    lastTimeStampMainView = new Date();
    fs.writeFileSync('tempImage.jpg', frame);
    let formData = {
      mediaStreamName: 'mainView',
      mediaMimeType: 'IMAGE_JPG',
      mediaTimestamp: lastTimeStampMainView.toJSON(),
      mediaData: fs.createReadStream('tempImage.jpg'),
    };
    request.post({
      url:`${backendLocation}/uploadMedia`,
      headers: {
        'Authorization':'Bearer ' + authToken
      },
      formData: formData
    },function cb(err, httpResponse, identifier) {
      if (err) {
        lastTimeStampMainView = oldLastTimeStampMainView;
        return console.error('Failed upload:', err);
      }
      // todo: check, if data was acutally stored on server side
      // since currently, only correct upload is checked for here
      console.log('Request send, server returned:', identifier);
    });
  }
});

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
    console.log('Updated cache at: ' + lastCacheUpdateTimeStamp);
  } catch (e) {
    // "reset" timestamp
    lastCacheUpdateTimeStamp = oldLastCacheUpdateTimeStamp;
    console.log('Error, cache not updated: ' + e);
  }
}
