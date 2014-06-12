/*!
 * Module dependencies.
 */

var markdown = require('github-flavored-markdown').parse
  , escape = require('./utils').escape;

var getPrototypeByIndex = function(index, prototypes) {
  var prototype = null,
      prototypesLength = prototypes.length,
      i;
  
  for (i = 0; i < prototypesLength; i++) {
    var proto = prototypes[i];
    
    if (proto.start <= index && index <= proto.end) {
      prototype = proto.name;
      break;
    }
  }
  
  return prototype;
};

/**
 * Expose api.
 */

exports.api = require('./api');

/**
 * Parse comments in the given string of `js`.
 *
 * @param {String} js
 * @param {Object} options
 * @return {Array}
 * @see exports.parseComment
 * @api public
 */

exports.parseComments = function(js, options){
  options = options || {};
  js = js.replace(/\r\n/gm, '\n');

  var comments = []
    , raw = options.raw
    , comment
    , buf = ''
    , ignore
    , withinMultiline = false
    , withinSingle = false
    , code
    , prototypesMap = [];
    
  var PROTOTYPES_REGEXP = /^[ ]*(.*).prototype = {/gm,
      EXTEND_PROTOTYPES_REGEXP = /[ ]*_.extend\((.*).prototype, {[\s\S]+?}\);/g;
  
  var prototypeMatch;
  
  while ((prototypeMatch = PROTOTYPES_REGEXP.exec(js)) !== null) {
    var body = prototypeMatch[1],
        indentation = prototypeMatch[0].match(/^\s+/)[0].length,
        start = prototypeMatch.index,
        end = start + prototypeMatch[0].length,
        CLOSE_PROTOTYPE_REGEXP = /^[ ]*};/gm;
    
    var rest = js.substr(start);
      
    var restMatch, restMatchIndentation;
      
    while ((restMatch = CLOSE_PROTOTYPE_REGEXP.exec(rest)) !== null) {
        if (restMatch[0].indexOf('};') === indentation) {
            end = start + restMatch.index + restMatch[0].length;
            break;
        }
    }
    
    prototypesMap.push(
      {
        name:  prototypeMatch[1].trim(),
        start: start,
        end: end
      }
    );
  }
    
  while ((prototypeMatch = EXTEND_PROTOTYPES_REGEXP.exec(js)) !== null) {
    var body = prototypeMatch[0],
        start = prototypeMatch.index,
        indentation = body.indexOf('_'),
        end = start + prototypeMatch[0].length,
        CLOSE_EXTEND_REGEXP = /[ ]*}\);/g;
      
    var rest = js.substr(start);
      
    var restMatch, restMatchIndentation;
      
    while ((restMatch = CLOSE_EXTEND_REGEXP.exec(rest)) !== null) {
        if (restMatch[0].indexOf('});') === indentation) {
            end = start + restMatch.index + restMatch[0].length;
            break;
        }
    }
    
    prototypesMap.push(
      {
        name: prototypeMatch[1].trim(),
        start: start,
        end: end
      }
    );
  }

  for (var i = 0, len = js.length; i < len; ++i) {
    // start comment
    if (!withinMultiline && !withinSingle && '/' == js[i] && '*' == js[i+1]) {
      // code following previous comment
      if (/\S/.test(buf)) {
        comment = comments[comments.length - 1];
        if(comment) {
          comment.code = code = buf.trimRight();
          comment.ctx = exports.parseCodeContext(code, getPrototypeByIndex(i - code.length + 1, prototypesMap));
        }
        buf = '';
      }
      i += 2;
      withinMultiline = true;
      ignore = '!' == js[i];
      buf += js[i];
    // end comment
    } else if (withinMultiline && !withinSingle && '*' == js[i] && '/' == js[i+1]) {
      i += 2;
      buf = buf.replace(/^[ \t]*\* ?/gm, '');
      var comment = exports.parseComment(buf, options);
      comment.ignore = ignore;
      comments.push(comment);
      withinMultiline = ignore = false;
      buf = '';
    } else if (!withinSingle && !withinMultiline && '/' == js[i] && '/' == js[i+1]) {
      withinSingle = true;
      buf += js[i];
    } else if (withinSingle && !withinMultiline && '\n' == js[i]) {
      withinSingle = false;
      buf += js[i];
    // buffer comment or code
    } else {
      buf += js[i];
    }
  }

  if (comments.length === 0) {
    comments.push({
      tags: [],
      description: {full: '', summary: '', body: ''},
      isPrivate: false
    });
  }

  // trailing code
  if (buf.trim().length) {
    comment = comments[comments.length - 1];
    code = buf.trimRight();
    comment.code = code;
    comment.ctx = exports.parseCodeContext(code);
  }

  return comments;
};

/**
 * Parse the given comment `str`.
 *
 * The comment object returned contains the following
 *
 *  - `tags`  array of tag objects
 *  - `description` the first line of the comment
 *  - `body` lines following the description
 *  - `content` both the description and the body
 *  - `isPrivate` true when "@api private" is used
 *
 * @param {String} str
 * @param {Object} options
 * @return {Object}
 * @see exports.parseTag
 * @api public
 */

exports.parseComment = function(str, options) {
  str = str.trim();
  options = options || {};

  // Prepend line break if first line is already a tag
  // instead of description
  if (!str.indexOf('@')) {
    str = '\n' + str;
  }
  
  var comment = { tags: [] }
    , raw = options.raw
    , description = {};

  // parse comment body
  description.full = str.split('\n@')[0];
  description.summary = description.full.split('\n\n')[0];
  description.body = description.full.split('\n\n').slice(1).join('\n\n');
  comment.description = description;

  // parse tags
  if (~str.indexOf('\n@')) {
    var tags = str.split('\n@').slice(1).map(function (tag) {
      return '@' + tag;
    });
    comment.tags = tags.map(exports.parseTag);
    comment.isPrivate = comment.tags.some(function(tag){
      return 'api' == tag.type && 'private' == tag.visibility;
    })
  }

  // markdown
  if (!raw) {
    description.full = markdown(description.full);
    description.summary = markdown(description.summary);
    description.body = markdown(description.body);
  }

  return comment;
}

/**
 * Parse tag string "@param {Array} name description" etc.
 *
 * @param {String}
 * @return {Object}
 * @api public
 */

exports.parseTag = function(str) {
  var tag = {}
    , types = []
    , parts = str.split(/[\s\n]+/)
    , type = tag.type = parts.shift().replace('@', '');

  if (type == 'param' || type == 'return' || type == 'type') {
    var last = parts.shift();
    types.push(last);
    if (types && last && last.indexOf("{") === 0) {
      while (last && last.lastIndexOf('}') !== last.length - 1) {
        last = parts.shift();
        types.push(last);
      }
    }
  }

  switch (type) {
    case 'param':
      tag.types = exports.parseTagTypes(types.join(' '));
      tag.name = parts.shift() || '';
      tag.description = parts.join(' ');
      break;
    case 'return':
      tag.types = exports.parseTagTypes(types.join(' '));
      tag.description = parts.join(' ');
      break;
    case 'see':
      if (~str.indexOf('http')) {
        tag.title = parts.length > 1
          ? parts.shift()
          : '';
        tag.url = parts.join(' ');
      } else {
        tag.local = parts.join(' ');
      }
      break;
    case 'api':
      tag.visibility = parts.shift();
      break;
    case 'type':
      tag.types = exports.parseTagTypes(types.join(' '));
      break;
    case 'memberOf':
      tag.parent = parts.shift();
      break;
    case 'augments':
      tag.otherClass = parts.shift();
      break;
    case 'borrows':
      tag.otherMemberName = parts.join(' ').split(' as ')[0];
      tag.thisMemberName = parts.join(' ').split(' as ')[1];
      break;
    case 'throws':
      tag.types = exports.parseTagTypes(parts.shift());
      tag.description = parts.join(' ');
      break;
    default:
      tag.string = parts.join(' ');
      break;
  }

  return tag;
}

/**
 * Parse tag type string "{Array|Object}" etc.
 *
 * @param {String} str
 * @return {Array}
 * @api public
 */

exports.parseTagTypes = function(str) {
  return str
    .replace(/^{/, '')
    .replace(/}$/, '')
    .split(/ *[|,\/] */);
};

/**
 * Parse the context from the given `str` of js.
 *
 * This method attempts to discover the context
 * for the comment based on it's code. Currently
 * supports:
 *
 *   - function statements
 *   - function expressions
 *   - prototype methods
 *   - prototype properties
 *   - methods
 *   - properties
 *   - declarations
 *
 * @param {String} str
 * @return {Object}
 * @api public
 */

exports.parseCodeContext = function(str, prototype){
  var str = str.trim().split('\n')[0];
  
  // function statement
  if (/^function ([\w$]+) *\(/.exec(str)) {
    return {
        type: 'function'
      , name: RegExp.$1
      , string: RegExp.$1 + '()'
    };
  // function expression
  } else if (/^var *([\w$]+)[ \t]*=[ \t]*function/.exec(str)) {
    return {
        type: 'function'
      , name: RegExp.$1
      , string: RegExp.$1 + '()'
    };
  // prototype method
  } else if (/^([\w$]+)\.prototype\.([\w$]+)[ \t]*=[ \t]*function/.exec(str)) {
    return {
        type: 'method'
      , constructor: RegExp.$1
      , cons: RegExp.$1
      , name: RegExp.$2
      , string: RegExp.$1 + '.prototype.' + RegExp.$2 + '()'
    };
  // prototype property
  } else if (/^([\w$]+)\.prototype\.([\w$]+)[ \t]*=[ \t]*([^\n;]+)/.exec(str)) {
    return {
        type: 'property'
      , constructor: RegExp.$1
      , cons: RegExp.$1
      , name: RegExp.$2
      , value: RegExp.$3
      , string: RegExp.$1 + '.prototype.' + RegExp.$2
    };
  // method
  } else if (/^(?:([\w$.]+)\.)?([\w$]+)[ \t]*[=:][ \t]*function/.exec(str)) {
    var receiver  = RegExp.$1 || prototype,
        name      = RegExp.$2;
    
    return {
        type: 'method'
      , receiver: receiver
      , name: name
      , string: receiver + '.' + name + '()'
    };
  // property
  } else if (/^(?:([\w$]+)\.)?([\w$]+)[ \t]*[=:][ \t]*([^\n;]+)/.exec(str)) {
    var receiver  = RegExp.$1 || prototype,
        name      = RegExp.$2;
    
    return {
        type: 'property'
      , receiver: receiver
      , name: name
      , value: RegExp.$3
      , string: receiver + '.' + name
    };
  // declaration
  } else if (/^var +([\w$]+)[ \t]*(?:=[ \t]*([^\n;]+))?/.exec(str)) {
    return {
        type: 'declaration'
      , name: RegExp.$1
      , value: RegExp.$2
      , string: RegExp.$1
    };
  }
};
