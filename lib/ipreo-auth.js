let ActiveDirectory = require('activedirectory'); 

export default class IpreoAuth {
    constructor({url, baseDN, slackGroup, username, password}) {
        this.slackGroup = slackGroup;
        
        let config = {
            url: url,
            baseDN: baseDN,
            username: username,
            password: password,
            slackGroup: slackGroup
        };
        this.ipreoAD = new ActiveDirectory(config);    
    }
    
    authenticate(email, fn) {
        this.ipreoAD.isUserMemberOf(email, this.slackGroup, function(err, isMember) {
           if (err) {
               console.log(err);
               fn(false, JSON.stringify(err));
               return;
           } 
           fn(isMember);
        });
        return;
    } 
}