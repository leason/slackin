
// es6 runtime requirements
import 'babel-polyfill';

// their code
import express from 'express';
import sockets from 'socket.io';
import { json } from 'body-parser';
import { Server as http } from 'http';
import remail from 'email-regex';
import dom from 'vd';

// our code
import Slack from './slack';
import invite from './slack-invite';
import badge from './badge';
import splash from './splash';
import iframe from './iframe';
import log from './log';
import IpreoAuth from './ipreo-auth';

export default function slackin({
  token,
  interval = 5000, // jshint ignore:line
  org,
  css,
  coc,
  path='/',
  channels,
  silent = false, // jshint ignore:line,
  url,
  baseDN,
  username,
  password,
  slackGroup
}){
  // must haves
  if (!token) throw new Error('Must provide a `token`.');
  if (!org) throw new Error('Must provide an `org`.');

  if (channels) {
    // convert to an array
    channels = channels.split(',').map((channel) => {
      // sanitize channel name
      if ('#' == channel[0]) return channel.substr(1);
      return channel;
    });
  }

  // setup app
  let app = express();
  let srv = http(app);
  let assets = __dirname + '/assets';

  let ipreoAuth = new IpreoAuth({
    url:url,
    username:username,
    passowrd:password,
    baseDN:baseDN,
    slackGroup:slackGroup
  });

  // fetch data
  let slack = new Slack({ token, interval, org });

  slack.setMaxListeners(Infinity);

  // capture stats
  log(slack, silent);

  // middleware for waiting for slack
  app.use((req, res, next) => {
    if (slack.ready) return next();
    slack.once('ready', next);
  });

  // splash page
  app.get('/', (req, res) => {
    let { name, logo } = slack.org;
    let { active, total } = slack.users;
    if (!name) return res.send(404);
    let page = dom('html',
      dom('head',
        dom('title',
          'Join ', name, ' on Slack!'
        ),
        dom('meta name=viewport content="width=device-width,initial-scale=1.0,minimum-scale=1.0,user-scalable=no"'),
        dom('link rel="shortcut icon" href=https://slack.global.ssl.fastly.net/272a/img/icons/favicon-32.png'),
        css && dom('link rel=stylesheet', { href: css })
      ),
      splash({ coc, path, css, name, org, logo, channels, active, total })
    );
    res.type('html');
    res.send(page.toHTML());
  });

  // static files
  app.use('/assets', express.static(assets));

  // invite endpoint
  app.post('/invite', json(), (req, res, next) => {
    let chanId;
    if (channels) {
      let channel = req.body.channel;
      if (!channels.includes(channel)) {
        return res
        .status(400)
        .json({ msg: 'Not a permitted channel' });
      }
      chanId = slack.getChannelId(channel);
      if (!chanId) {
        return res
        .status(400)
        .json({ msg: `Channel not found "${channel}"` });
      }
    }

    let email = req.body.email;

    if (!email) {
      return res
      .status(400)
      .json({ msg: 'No email provided' });
    }

    if (!remail().test(email)) {
      return res
      .status(400)
      .json({ msg: 'Invalid email' });
    }
    
    // Test to make sure the email is either Ipreo or EPAM
    if (email.toLowerCase().indexOf("@ipreo.com") < 0 &&
        email.toLowerCase().indexOf("@epam.com") < 0) { 
      return res
      .status(400)
      .json({msg: 'Invalid email.  Must be an approved Ipreo email address.'});
    }

    if (coc && '1' != req.body.coc) {
      return res
      .status(400)
      .json({ msg: 'Agreement to CoC is mandatory' });
    }

    ipreoAuth.authenticate(email, function(isAuthorized, error){
      if (error) {
        return res.status(400).json({msg:"Error querying ActiveDirectory"});
      }
      
      if (isAuthorized) {
        invite({ token, org, email, channel: chanId }, err => {
          if (err) {
            if (err.message === `Sending you to Slack...`) {
              return res
              .status(303)
              .json({ msg: err.message, redirectUrl: `https://${org}.slack.com` });
            }
    
            return res
            .status(400)
            .json({ msg: err.message });
          }
    
          res
          .status(200)
          .json({ msg: 'WOOT. Check your email!' });
        });        
      } else {
        return res.status(400).json({msg:"Not a member of '"+slackGroup+"' in ActiveDirectory.  Please contact helpme."});
      }
    });

   
  });

  // iframe
  app.get('/iframe', (req, res) => {
    let large = 'large' in req.query;
    let { active, total } = slack.users;
    res.type('html');
    res.send(iframe({ path, active, total, large }).toHTML());
  });

  app.get('/iframe/dialog', (req, res) => {
    let { name } = slack.org;
    let { active, total } = slack.users;
    if (!name) return res.send(404);
    let dom = splash({ coc, path, name, channels, active, total, iframe: true });
    res.type('html');
    res.send(dom.toHTML());
  });

  // badge js
  app.use('/slackin.js', express.static(assets + '/badge.js'));

  // badge rendering
  app.get('/badge.svg', (req, res) => {
    res.type('svg');
    res.set('Cache-Control', 'max-age=0, no-cache');
    res.set('Pragma', 'no-cache');
    res.send(badge(slack.users).toHTML());
  });

  // realtime
  sockets(srv).on('connection', socket => {
    socket.emit('data', slack.users);
    let change = (key, val) => socket.emit(key, val);
    slack.on('change', change);
    socket.on('disconnect', () => {
      slack.removeListener('change', change);
    });
  });

  return srv;
}
