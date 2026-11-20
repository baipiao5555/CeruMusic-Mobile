// Pinned compatibility metadata; original code executes only inside the plugin sandbox after user confirmation.
export const knownCatalogManifests: Record<string, any> = {
  "853f39376e29f3ff4e85cee83dbcfd864d08f7f0934be14d216c65583b83fdc0": {
    "manifestVersion": 2,
    "id": "ceru.172mix",
    "name": "172Mix",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.172mix",
          "name": "172Mix",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "8cbe30b6d599c50f75706c84a7a2aad069c5e8dc8d2994a6bc4f860ac3010cb6": {
    "manifestVersion": 2,
    "id": "ceru.1ting",
    "name": "一听音乐",
    "version": "1.0.0",
    "description": "支持音质：128k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.1ting",
          "name": "一听音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "128k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "670ec6bd4680ca5107e2fb693f3fd5c00b2deb7ba3dca3e32f9aa4cb24d9ed29": {
    "manifestVersion": 2,
    "id": "ceru.36dj",
    "name": "36DJ",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.36dj",
          "name": "36DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "fab17c8c7db739200289ab44504ad1c534d331995c6bc71b9db7c3256be9bd99": {
    "manifestVersion": 2,
    "id": "ceru.54dj",
    "name": "我是DJ",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.54dj",
          "name": "我是DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "4a5190c6656fd58a6db5af92049288bbf6e64cccb8f3f33f7ce2c506eca5c0c3": {
    "manifestVersion": 2,
    "id": "ceru.5sing",
    "name": "5sing",
    "version": "1.0.0",
    "description": "支持音质：128k/192k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.5sing",
          "name": "5sing",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1"
          ],
          "qualities": [
            "128k",
            "192k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "a8ed322c3f729aebae736411aa75a971f641c45748fa8e967f2b774648c1c2e6": {
    "manifestVersion": 2,
    "id": "ceru.73dj",
    "name": "73DJ",
    "version": "1.0.0",
    "description": "73DJ",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.73dj",
          "name": "73DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "3c18f6a0bcbb4e62b094325379718714995d1b6e9bfa976d223e3139f2e1ff72": {
    "manifestVersion": 2,
    "id": "ceru.82dj",
    "name": "82DJ舞曲网",
    "version": "1.0.0",
    "description": "支持音质：64k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.82dj",
          "name": "82DJ舞曲网",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "f9f0f84f07ca5cb1091ac8a7332310a202cde44d52c9c597fb528a608e68ffaa": {
    "manifestVersion": 2,
    "id": "ceru.applemusic",
    "name": "Apple Music",
    "version": "1.0.0",
    "description": "Apple Music 搜索 + 酷我兜底取链，音质 128k/320k/flac",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索 Apple Music、取酷我兜底播放地址与歌词需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.applemusic",
          "name": "Apple Music",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "f5de04df44020ee46167b3bcd29d27fa2d10a02a3e56d2e268681f07c974465d": {
    "manifestVersion": 2,
    "id": "ceru.bibdj",
    "name": "宝贝DJ",
    "version": "1.0.0",
    "description": "支持音质：128k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.bibdj",
          "name": "宝贝DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "128k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "5b877c8522c59fe57a452b52e30a683f35d4c164d14a1ce3d72f2c63904fb27a": {
    "manifestVersion": 2,
    "id": "ceru.bobidj",
    "name": "波比DJ",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.bobidj",
          "name": "波比DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "919cb4c2d174991bb9cedc9f56f5060953c893319db59b84bacaa20edaff6c44": {
    "manifestVersion": 2,
    "id": "ceru.bokantingshu",
    "name": "博看听书",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.bokantingshu",
          "name": "博看听书",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "0239e89c0781348c243ed980595ced86ca76db3d7cb029336d5c21a1570b4476": {
    "manifestVersion": 2,
    "id": "ceru.cctv",
    "name": "CCTV听音",
    "version": "1.0.0",
    "description": "央视听音，AAC over HLS，音质 128k/64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.cctv",
          "name": "CCTV听音",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "128k",
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "fcec78830cdb8fbaf1a45b7484fddba9b3229986c9f5693c72f2e423bed43f5d": {
    "manifestVersion": 2,
    "id": "ceru.ddddj",
    "name": "清风DJ",
    "version": "1.0.0",
    "description": "支持音质：96k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.ddddj",
          "name": "清风DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "96k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "c6df0526f96a4cc5494311dac53ac1addc256937988d48a7c8108a5fd74bfe59": {
    "manifestVersion": 2,
    "id": "ceru.dianyinge",
    "name": "电音阁",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.dianyinge",
          "name": "电音阁",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "d42f51fa67897a4b9a766a67f9a5557b1c1f7d01922d1a8185122a1b80a770db": {
    "manifestVersion": 2,
    "id": "ceru.dj54",
    "name": "我是DJ",
    "version": "1.1.2",
    "description": "54dj DJ 音源（搜索 / 取链 / 榜单，64k m4a）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索歌曲、取播放地址与榜单需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.dj54",
          "name": "我是DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ],
      "homeSections": [
        {
          "id": "dj54-charts",
          "title": "我是DJ榜单",
          "kind": "charts",
          "providerIds": [
            "ceru.dj54"
          ],
          "order": 30
        }
      ]
    }
  },
  "4acd5a3125a9da842f3de3d304afd9534cd006f072fa1f2b86af07bae936a130": {
    "manifestVersion": 2,
    "id": "ceru.dj6",
    "name": "DJ6",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.dj6",
          "name": "DJ6",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "80c52906a90f172f699dd614da6b172afbd12e1ac752c4c06b3c4f4dd15db957": {
    "manifestVersion": 2,
    "id": "ceru.dj766",
    "name": "DJ766",
    "version": "1.0.0",
    "description": "支持音质：96k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.dj766",
          "name": "DJ766",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "96k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "bf5db5f75122217632a012d398ab668bd33bb9c2559bf73b710f2b43348fd586": {
    "manifestVersion": 2,
    "id": "ceru.djcsj",
    "name": "DJ串烧集",
    "version": "1.0.0",
    "description": "支持音质：64k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.djcsj",
          "name": "DJ串烧集",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1",
            "music.playlists@1"
          ],
          "qualities": [
            "64k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "86a00fffbe0f786f81c4e70a11c6a1449ea47233d420d93bf66b84ec5036a6e2": {
    "manifestVersion": 2,
    "id": "ceru.djduoduo",
    "name": "DJ多多",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.djduoduo",
          "name": "DJ多多",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "3a611fdf27a06ecf4db802106d1935682ed66494bbb4cbeaafe2670ccfca605d": {
    "manifestVersion": 2,
    "id": "ceru.djkk",
    "name": "DJKK",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.djkk",
          "name": "DJKK",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "3375ea64a99b28862fc20afc2594baac1acc5d42dc447df4afd19a54b86a3751": {
    "manifestVersion": 2,
    "id": "ceru.djmei",
    "name": "魅力DJ",
    "version": "1.0.0",
    "description": "支持音质：128k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.djmei",
          "name": "魅力DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "128k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "6c8c3283e45a5ca61379b8d4fa5330844a979bd379bf402a52914ee7be53e767": {
    "manifestVersion": 2,
    "id": "ceru.djyule",
    "name": "DJ娱乐",
    "version": "1.0.0",
    "description": "支持音质：64k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.djyule",
          "name": "DJ娱乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "ae8c578b365bfebb71b66082317c5dc1c2651512e2b224cc935c10ceec69e077": {
    "manifestVersion": 2,
    "id": "ceru.djyyy",
    "name": "DJ耶耶耶",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.djyyy",
          "name": "DJ耶耶耶",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "2dd8e18d4825b25d689468833454e3b3386cbd29d7cdbb1fbce15ad9dec96e7c": {
    "manifestVersion": 2,
    "id": "ceru.htqyy",
    "name": "好听轻音乐",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.htqyy",
          "name": "好听轻音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "1d4b67be0c0a7401c72b07fefaae9edb35e8609e9c413382e67e5932a5e6ef97": {
    "manifestVersion": 2,
    "id": "ceru.huole",
    "name": "火龙DJ",
    "version": "1.0.0",
    "description": "支持音质：64k/320k/flac",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.huole",
          "name": "火龙DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "f73fe7f1a78e93528ae8da4dfb9e3fb93aff9fc5c927ea8efd2fbe0062abf237": {
    "manifestVersion": 2,
    "id": "ceru.huolongdj",
    "name": "火龙DJ",
    "version": "1.0.0",
    "description": "支持音质：64k/320k/flac",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.huolongdj",
          "name": "火龙DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "fdccdf908ca995fdbfc54c86e9d17bfbda209287de2100623691d223d4db936d": {
    "manifestVersion": 2,
    "id": "ceru.hy57",
    "name": "黑色音频",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.hy57",
          "name": "黑色音频",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "2769c1c1ad71a8d04270ede4b4afc63617812f3512310fa37c3a9c8a2b6bf0cd": {
    "manifestVersion": 2,
    "id": "ceru.joox",
    "name": "JOOX音乐",
    "version": "1.0.0",
    "description": "支持音质：128k/320k/flac",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.joox",
          "name": "JOOX音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "c02fe20b2f542bcf691034c5edfc3c5f29dfa5ef28711a5b5949c5a318a37212": {
    "manifestVersion": 2,
    "id": "ceru.kuaiyin",
    "name": "快音",
    "version": "1.0.0",
    "description": "支持音质：128k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.kuaiyin",
          "name": "快音",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "128k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "1cfe07741436894506550bdd1bcc840d934fad2f7b66709fdb88f840bfb3fef8": {
    "manifestVersion": 2,
    "id": "ceru.kugou",
    "name": "酷狗音乐",
    "version": "2.0.1",
    "description": "酷狗音乐音源（搜索 / 取链 / 歌词 / 榜单 / 歌单；320k/无损走酷狗 Cookie 或酷我换源兜底）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索歌曲、取播放地址、歌词与歌单需要访问网络"
      }
    ],
    "config": {
      "kugouCookie": "",
      "kgKuwoFallback": true,
      "kgNianxin": true
    },
    "contributes": {
      "providers": [
        {
          "id": "kugou",
          "name": "酷狗音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1",
            "music.playlists@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ],
      "homeSections": [
        {
          "id": "kugou-charts",
          "title": "酷狗榜单",
          "kind": "charts",
          "providerIds": [
            "kugou"
          ],
          "order": 12
        }
      ],
      "playlistImporters": [
        {
          "id": "kugou-import",
          "title": "酷狗歌单",
          "providerId": "kugou",
          "placeholder": "粘贴酷狗歌单链接、分享口令或纯数字酷狗码",
          "description": "从酷狗歌单链接 / 分享页 / 酷狗码导入曲目",
          "examples": [
            {
              "label": "酷狗歌单示例",
              "value": "https://www.kugou.com/yy/special/single/2450179.html"
            }
          ]
        }
      ],
      "commands": [
        {
          "id": "kugou.clearCache",
          "title": "清空酷狗缓存",
          "description": "清除榜单/封面缓存，下次进入重新拉取",
          "action": "kugou.clearCache"
        },
        {
          "id": "kugou.searchTrack",
          "title": "用酷狗搜索歌曲",
          "action": "kugou.searchTrack"
        }
      ],
      "menus": [
        {
          "id": "kugou.menu.searchTrack",
          "slot": "track.actions",
          "title": "用酷狗搜索",
          "commandId": "kugou.searchTrack",
          "when": {
            "kinds": [
              "track"
            ]
          }
        }
      ],
      "lyricConverters": [
        {
          "id": "kugou.lyric",
          "title": "酷狗歌词转换",
          "formats": [
            "lrc",
            "enhanced-lrc",
            "ttml",
            "auto"
          ]
        }
      ]
    }
  },
  "adee14e80c304a18b0b9aac95bff3722f8533f69ac0999294387db54f754a435": {
    "manifestVersion": 2,
    "id": "ceru.kuwo",
    "name": "酷我音乐",
    "version": "2.0.1",
    "description": "酷我音乐音源（搜索 / 取链 / 歌词 / 榜单 / 歌单）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索歌曲、取播放地址、歌词与歌单需要访问网络"
      }
    ],
    "config": {
      "kwFlacHi": true,
      "kwHaiTang": true,
      "kwCihedai": true,
      "kwBuguyy": true,
      "hywCardKey": "6C1F-53W0-GRKI-EVFG"
    },
    "contributes": {
      "providers": [
        {
          "id": "kuwo",
          "name": "酷我音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1",
            "music.playlists@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ],
      "homeSections": [
        {
          "id": "kuwo-charts",
          "title": "酷我榜单",
          "kind": "charts",
          "providerIds": [
            "kuwo"
          ],
          "order": 10
        }
      ],
      "playlistImporters": [
        {
          "id": "kuwo-import",
          "title": "酷我歌单/专辑",
          "providerId": "kuwo",
          "placeholder": "粘贴酷我歌单链接，如 https://www.kuwo.cn/playlist_detail/1589713",
          "description": "从酷我歌单/专辑链接导入曲目",
          "examples": [
            {
              "label": "酷我歌单示例",
              "value": "https://www.kuwo.cn/playlist_detail/1589713"
            }
          ]
        }
      ],
      "commands": [
        {
          "id": "kuwo.clearCache",
          "title": "清空酷我榜单缓存",
          "description": "清除榜单列表缓存，下次进入重新拉取",
          "action": "kuwo.clearCache"
        },
        {
          "id": "kuwo.searchTrack",
          "title": "用酷我搜索歌曲",
          "action": "kuwo.searchTrack"
        }
      ],
      "menus": [
        {
          "id": "kuwo.menu.searchTrack",
          "slot": "track.actions",
          "title": "用酷我搜索",
          "commandId": "kuwo.searchTrack",
          "when": {
            "kinds": [
              "track"
            ]
          }
        }
      ],
      "lyricConverters": [
        {
          "id": "kuwo.lyric",
          "title": "酷我歌词转换",
          "formats": [
            "lrc",
            "enhanced-lrc",
            "ttml",
            "auto"
          ]
        }
      ]
    }
  },
  "0e8f2d95706f9c31365da49352db7520a169b236b6e9f9ee2d4631cb67fd6d36": {
    "manifestVersion": 2,
    "id": "ceru.lizhi",
    "name": "荔枝FM",
    "version": "1.0.0",
    "description": "支持音质：64k/128k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.lizhi",
          "name": "荔枝FM",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "64k",
            "128k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "a347e46c3f340bd6dd9cefb866516942b696c3bc6fed61a1765088abb9265c4a": {
    "manifestVersion": 2,
    "id": "ceru.migu",
    "name": "咪咕音乐",
    "version": "2.0.0",
    "description": "咪咕音乐音源（搜索 / 取链 / 歌词 / 榜单 / 歌单）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索歌曲、取播放地址、歌词与歌单需要访问网络"
      }
    ],
    "config": {
      "mgHaiTang": true,
      "mgOiapi": true,
      "mgKuwo": true
    },
    "contributes": {
      "providers": [
        {
          "id": "migu",
          "name": "咪咕音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1",
            "music.playlists@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac",
            "flac24bit"
          ],
          "connectionMode": "none"
        }
      ],
      "homeSections": [
        {
          "id": "migu-charts",
          "title": "咪咕榜单",
          "kind": "charts",
          "providerIds": [
            "migu"
          ],
          "order": 11
        }
      ],
      "playlistImporters": [
        {
          "id": "migu-import",
          "title": "咪咕歌单",
          "providerId": "migu",
          "placeholder": "粘贴咪咕歌单链接，如 https://music.migu.cn/v3/music/playlist/195233074",
          "description": "从咪咕歌单链接或纯数字歌单 ID 导入曲目",
          "examples": [
            {
              "label": "咪咕歌单示例",
              "value": "https://music.migu.cn/v3/music/playlist/195233074"
            }
          ]
        }
      ],
      "commands": [
        {
          "id": "migu.clearCache",
          "title": "清空咪咕缓存",
          "description": "清除咪咕歌曲元数据与榜单缓存",
          "action": "migu.clearCache"
        },
        {
          "id": "migu.searchTrack",
          "title": "用咪咕搜索歌曲",
          "action": "migu.searchTrack"
        }
      ],
      "menus": [
        {
          "id": "migu.menu.searchTrack",
          "slot": "track.actions",
          "title": "用咪咕搜索",
          "commandId": "migu.searchTrack",
          "when": {
            "kinds": [
              "track"
            ]
          }
        }
      ],
      "lyricConverters": [
        {
          "id": "migu.lyric",
          "title": "咪咕歌词转换",
          "formats": [
            "lrc",
            "enhanced-lrc",
            "ttml",
            "auto"
          ]
        }
      ]
    }
  },
  "0964f8fd4072a6d6b30fe1d913286566eddfe5eadd987490081a86ce9acdbbf3": {
    "manifestVersion": 2,
    "id": "ceru.missevan",
    "name": "猫耳FM",
    "version": "1.0.0",
    "description": "支持音质：128k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.missevan",
          "name": "猫耳FM",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "128k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "de04bd738e56ff8b520915b11f7bc1ffe6672b6e4e7746ae928fd0f2c1d5a247": {
    "manifestVersion": 2,
    "id": "ceru.mixdj",
    "name": "MixDJ",
    "version": "1.0.0",
    "description": "支持音质：128k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.mixdj",
          "name": "MixDJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "128k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "77c658f65480b1884d44a15c34e7172cf45df7a69cf2cf3a3ba642467b5f1af8": {
    "manifestVersion": 2,
    "id": "ceru.netease",
    "name": "网易云音乐",
    "version": "2.0.0",
    "description": "网易云音乐音源（搜索 / 取链 / 歌词 / 榜单 / 歌单）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索歌曲、取播放地址、歌词与歌单需要访问网络"
      }
    ],
    "config": {
      "neteaseCookie": "",
      "neThird": true,
      "neHaiTang": true
    },
    "contributes": {
      "providers": [
        {
          "id": "netease",
          "name": "网易云音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1",
            "music.playlists@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac",
            "flac24bit"
          ],
          "connectionMode": "none"
        }
      ],
      "homeSections": [
        {
          "id": "netease-charts",
          "title": "网易云榜单",
          "kind": "charts",
          "providerIds": [
            "netease"
          ],
          "order": 11
        }
      ],
      "playlistImporters": [
        {
          "id": "netease-import",
          "title": "网易云歌单",
          "providerId": "netease",
          "placeholder": "粘贴网易云歌单/专辑链接，如 https://music.163.com/#/playlist?id=3778678",
          "description": "从网易云歌单链接或纯数字歌单 ID 导入曲目",
          "examples": [
            {
              "label": "网易云歌单示例",
              "value": "https://music.163.com/#/playlist?id=3778678"
            }
          ]
        }
      ],
      "commands": [
        {
          "id": "netease.clearCache",
          "title": "清空网易云缓存",
          "description": "清除网易云歌曲元数据缓存",
          "action": "netease.clearCache"
        },
        {
          "id": "netease.searchTrack",
          "title": "用网易云搜索歌曲",
          "action": "netease.searchTrack"
        }
      ],
      "menus": [
        {
          "id": "netease.menu.searchTrack",
          "slot": "track.actions",
          "title": "用网易云搜索",
          "commandId": "netease.searchTrack",
          "when": {
            "kinds": [
              "track"
            ]
          }
        }
      ],
      "lyricConverters": [
        {
          "id": "netease.lyric",
          "title": "网易云歌词转换",
          "formats": [
            "lrc",
            "enhanced-lrc",
            "ttml",
            "auto"
          ]
        }
      ]
    }
  },
  "cf875824290aa3e04079ec3623428b6c0033f28d8988ef350c95ed663cd238a1": {
    "manifestVersion": 2,
    "id": "ceru.neteaseradio",
    "name": "网易电台",
    "version": "1.0.0",
    "description": "支持音质：128k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.neteaseradio",
          "name": "网易电台",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1"
          ],
          "qualities": [
            "128k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "80edf2c22c884a43900020008936fd6c4e26e209abbea3571c7ff8d5502041b6": {
    "manifestVersion": 2,
    "id": "ceru.pgdjz",
    "name": "皮狗DJ",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.pgdjz",
          "name": "皮狗DJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "833890f78dedc962d402b819c14c42ce8c62a32608b3cf1fc50e5b76c3138adf": {
    "manifestVersion": 2,
    "id": "ceru.qianqian",
    "name": "千千音乐",
    "version": "1.0.0",
    "description": "支持音质：128k/320k/flac",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.qianqian",
          "name": "千千音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "b623e8b8af23b8e39f87a11f5dada70ed9072a3d3ddbf98a84a9c9f4e6c4254c": {
    "manifestVersion": 2,
    "id": "ceru.qingting",
    "name": "蜻蜓FM",
    "version": "1.0.0",
    "description": "支持音质：128k/64k/24k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.qingting",
          "name": "蜻蜓FM",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "128k",
            "64k",
            "24k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "ac15e0630999ad888adb4cd8c85c9e0bbbde34ef02e304451fbf93da2296abf9": {
    "manifestVersion": 2,
    "id": "ceru.qishui",
    "name": "汽水音乐",
    "version": "2.0.0",
    "description": "汽水音乐音源（搜索 / 取链 / 歌词 / 榜单 / 歌单）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索歌曲、取播放地址、歌词与歌单需要访问网络"
      }
    ],
    "config": {
      "qsKuwo": true,
      "qsSessionId": ""
    },
    "contributes": {
      "providers": [
        {
          "id": "qishui",
          "name": "汽水音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1",
            "music.playlists@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ],
      "homeSections": [
        {
          "id": "qishui-charts",
          "title": "汽水榜单",
          "kind": "charts",
          "providerIds": [
            "qishui"
          ],
          "order": 11
        }
      ],
      "playlistImporters": [
        {
          "id": "qishui-import",
          "title": "汽水歌单",
          "providerId": "qishui",
          "placeholder": "粘贴汽水歌单链接，如 https://qishui.douyin.com/s/xxxx 或含 playlist_id 的链接",
          "description": "从汽水歌单链接或纯数字歌单 ID 导入曲目",
          "examples": [
            {
              "label": "汽水歌单示例",
              "value": "https://qishui.douyin.com/s/XXXX"
            }
          ]
        }
      ],
      "commands": [
        {
          "id": "qishui.clearCache",
          "title": "清空汽水缓存",
          "description": "清除汽水歌曲元数据与榜单缓存",
          "action": "qishui.clearCache"
        },
        {
          "id": "qishui.searchTrack",
          "title": "用汽水搜索歌曲",
          "action": "qishui.searchTrack"
        }
      ],
      "menus": [
        {
          "id": "qishui.menu.searchTrack",
          "slot": "track.actions",
          "title": "用汽水搜索",
          "commandId": "qishui.searchTrack",
          "when": {
            "kinds": [
              "track"
            ]
          }
        }
      ],
      "lyricConverters": [
        {
          "id": "qishui.lyric",
          "title": "汽水歌词转换",
          "formats": [
            "lrc",
            "enhanced-lrc",
            "ttml",
            "auto"
          ]
        }
      ]
    }
  },
  "44cacd0a617985e67ae06aad45f1fb9d8cfeda32c8b991d90d18b6ba2facc776": {
    "manifestVersion": 2,
    "id": "ceru.qq",
    "name": "QQ音乐",
    "version": "2.0.0",
    "description": "QQ音乐音源（搜索 / 取链 / 歌词 / 榜单 / 歌单）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索歌曲、取播放地址、歌词与歌单需要访问网络"
      }
    ],
    "config": {
      "qqS01s": true,
      "qqXunhuisi": true,
      "qqHaiTang": true
    },
    "contributes": {
      "providers": [
        {
          "id": "qq",
          "name": "QQ音乐",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1",
            "music.playlists@1"
          ],
          "qualities": [
            "128k",
            "320k",
            "flac",
            "flac24bit"
          ],
          "connectionMode": "none"
        }
      ],
      "homeSections": [
        {
          "id": "qq-charts",
          "title": "QQ榜单",
          "kind": "charts",
          "providerIds": [
            "qq"
          ],
          "order": 11
        }
      ],
      "playlistImporters": [
        {
          "id": "qq-import",
          "title": "QQ歌单",
          "providerId": "qq",
          "placeholder": "粘贴QQ歌单链接，如 https://y.qq.com/n/ryqq/playlist/7767987614",
          "description": "从QQ歌单链接或纯数字歌单 ID 导入曲目",
          "examples": [
            {
              "label": "QQ歌单示例",
              "value": "https://y.qq.com/n/ryqq/playlist/7767987614"
            }
          ]
        }
      ],
      "commands": [
        {
          "id": "qq.clearCache",
          "title": "清空QQ缓存",
          "description": "清除QQ歌曲元数据缓存",
          "action": "qq.clearCache"
        },
        {
          "id": "qq.searchTrack",
          "title": "用QQ搜索歌曲",
          "action": "qq.searchTrack"
        }
      ],
      "menus": [
        {
          "id": "qq.menu.searchTrack",
          "slot": "track.actions",
          "title": "用QQ搜索",
          "commandId": "qq.searchTrack",
          "when": {
            "kinds": [
              "track"
            ]
          }
        }
      ],
      "lyricConverters": [
        {
          "id": "qq.lyric",
          "title": "QQ歌词转换",
          "formats": [
            "lrc",
            "enhanced-lrc",
            "ttml",
            "auto"
          ]
        }
      ]
    }
  },
  "23c87f9072345fb947eb2f6aa2d8720cf12f22fbdc96a0796a5b0becfa133e2e": {
    "manifestVersion": 2,
    "id": "ceru.qqdj",
    "name": "QQDJ",
    "version": "1.0.0",
    "description": "支持音质：96k/320k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.qqdj",
          "name": "QQDJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "96k",
            "320k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "6fb9715ff054ba6d88878479e9ed60e8da9517d71d978553e5fa2236cfe2c433": {
    "manifestVersion": 2,
    "id": "ceru.spacedj",
    "name": "SpaceDJ",
    "version": "1.0.0",
    "description": "支持音质：96k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.spacedj",
          "name": "SpaceDJ",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "96k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "c1f9ad4957134d2fcb3c1674362cd4acb8bf8271fadb9d7a41ecd23027d0f6de": {
    "manifestVersion": 2,
    "id": "ceru.streetvoice",
    "name": "街声",
    "version": "1.0.0",
    "description": "街声独立音乐，96k HLS 单档",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.streetvoice",
          "name": "街声",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.lyrics@1",
            "music.charts@1"
          ],
          "qualities": [
            "96k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "91b21a8af16aa8b5616a8a3d4f72ed6a7314cc5971b9a3a057a8a3fc80e4b138": {
    "manifestVersion": 2,
    "id": "ceru.ximalaya",
    "name": "喜马拉雅",
    "version": "1.0.0",
    "description": "支持音质：64k（免费声音）",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.ximalaya",
          "name": "喜马拉雅",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "64d9815e3fac73d645c51cdf3781a4f6df3656491f6849e05e13c10b756124cf": {
    "manifestVersion": 2,
    "id": "ceru.xxedm",
    "name": "小熊电音",
    "version": "1.0.0",
    "description": "支持音质：64k",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.xxedm",
          "name": "小熊电音",
          "protocols": [
            "music.search@1",
            "music.resolve@1"
          ],
          "qualities": [
            "64k"
          ],
          "connectionMode": "none"
        }
      ]
    }
  },
  "42f0d4e51987661927dcb836b59be832f416056f76ed5c158661591fe14eea59": {
    "manifestVersion": 2,
    "id": "ceru.y2002",
    "name": "Y2002电音",
    "version": "1.0.0",
    "description": "支持音质：64k/320k/flac",
    "author": "hebijunge",
    "engines": {
      "hostApi": "^2.0.0",
      "logicRuntime": "ceru-js@1"
    },
    "modules": {
      "logic": {
        "entry": "logic.main"
      }
    },
    "permissions": [
      {
        "key": "network",
        "name": "network.request",
        "reason": "搜索与取链需要访问网络"
      }
    ],
    "contributes": {
      "providers": [
        {
          "id": "ceru.y2002",
          "name": "Y2002电音",
          "protocols": [
            "music.search@1",
            "music.resolve@1",
            "music.charts@1"
          ],
          "qualities": [
            "64k",
            "320k",
            "flac"
          ],
          "connectionMode": "none"
        }
      ]
    }
  }
}
