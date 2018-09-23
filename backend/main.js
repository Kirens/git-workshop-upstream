const cgi = require('cgi')
const http = require('http')
const { exec: execRaw } = require('child_process')

const {
  authenticate,
  createPasswordForUser,
} = require('./users.js')


const exec
  = cmd => new Promise((resolve, reject) => {
    console.log(cmd)
    execRaw(cmd, (err, stdout, stderr)  => {
      if(err) {
        console.error(err, stderr)
        reject(err)
      }
      resolve(stdout)
    })
  })

const gitCGI = cgi('/usr/lib/git-core/git-http-backend', {
  env: {
    GIT_HTTP_EXPORT_ALL: "",
    GIT_PROJECT_ROOT: '/srv/gitrepos',
    // Pretend the user is authenticated
    REMOTE_USER: 'a-git-user',
  },
  stderr: process.stderr
})

const root = '/srv/gitrepos/root/'
const projectData = {
  'introducetion': {
    location: 'akaProxy.github.io',
    hook: (path, user) => async i => {
      if(i != 1) return

      console.log('I am', await exec('whoami'))

      const cmd = `cd /srv/gitrepos/${path}`
                + ` && echo 'Hej ${user}' >> README.md`
                + ' && git commit'
                  + ' --author="Woody and the IT-smurf <woody-smurf@dhack.se>"'
                  + ' -am "Tought we\'d add a greeting"'
      await exec(cmd)
    },
  },
//  'Push n\' Pull': '',
}
const projects = Object.keys(projectData)

const api
  = (req, res) => {
    console.log('API request')
    switch (req.method.toLowerCase()) {
      case 'post':
        let body = [];
        req
          .on('data', chunk => body.push(chunk))
          .on('end', async () => {
            const {project, username} = JSON.parse(Buffer.concat(body).toString())
            const password = createPasswordForUser(username)
            if(!password) {
              res.writeHead(409, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
              })
              res.end(JSON.stringify({message: 'username invalid or taken'}))
              return
            }
            const url = await deployProject(project, username)
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type',
            })
            res.end(JSON.stringify({ username, password, url }))
          })
        break
      case 'options':
        res.writeHead(200, {
          'Allow': 'OPTIONS, GET, POST',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        res.end('')
        break
      default:
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        res.end(JSON.stringify(projects))
    }
  }


const deployedProjects = new Map()
const deployProject = async (project, user) => {
  const projectPath = user + '/' + projectData[project].location

  // TODO: very stupid to pass user-data into this
  const cmd = `mkdir -p /srv/gitrepos/${user}`
            + ` && cd /srv/gitrepos/${user}`
            + ` && git clone ${root}/${projectData[project].location}.git`
  await exec(cmd)

  deployedProjects.set(projectPath, {hook: projectData[project].hook(projectPath, user), i: 0})
  return '/git/api/' + projectPath
}

const nothing = () => nothing
const hook
  = async projectPath => {
    const proj = deployedProjects.get(projectPath)
    if(!proj) return
    await proj.hook(proj.i++)
  }

const server = async (req, res) => {
  if(req.url === '/git/api/projects') return api(req, res)

  console.log('Req:', req.url)

  const user
    = req.url.endsWith('/info/refs?service=git-upload-pack')
      || req.url.endsWith('/git-upload-pack')
    // /akaProxy.github.io/git-upload-pack
    ? authenticate(req.headers.authorization)
    : 'anyone'

  if (!user) {
    res.statusCode = 401
    res.setHeader('WWW-Authenticate', 'Basic realm="example"')
    res.end('Access denied')
    return
  }

  req.url = req.url.slice(4) // remove /git
  await hook((/^\/([^\/]+\/[^\/]+)/g).exec(req.url)[1])
  gitCGI(req, res)
}

const catcher
  = hdlr => async (req, res) => {
    try {
      await hdlr(req, res)
    } catch(e) {
      console.error(e)
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end(JSON.stringify({message: 'unknown error'}))
    }
  }

http.createServer(catcher(server)).listen(8080)
console.log('Password for root:', createPasswordForUser('root'))
console.log('My home is:', process.env.HOME)