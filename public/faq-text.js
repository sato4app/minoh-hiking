// 「ご利用の注意とよくある質問」の文言
// 設定/Settings のトグルから表示する内容で、**本ファイルがこの文言の正本**。
// 以前は docs/faq-202609.md にも同じ内容を置いていたが、同じ説明が2か所にあると
// 片方だけ直して食い違うため、文書は廃止して本ファイルに一本化した(2026-09-06)。
//
// 構成:
//   FAQ_NOTICES  … ご利用の注意(9項目)。1行の要約と、詳しい説明のある質問への参照
//   FAQ_SECTIONS … よくある質問(7分類・27問)。説明の本体はこちらにだけ置く
//
// ご利用の注意を増やすときは、対応する質問を FAQ_SECTIONS に用意し、ref で指すこと
// (注意側に本文を書くと、また二重管理になる)。
//
// 文言は { ja, en } の両方を持つ。en が無いときは ja を出す(faq.js の pick)。
// 英文中の画面の名前(「設定/Settings」「Record track」など)は、i18n.js の
// 英語表記と必ず一致させること。食い違うと、英語表示の利用者が画面上で
// 該当する項目を見つけられなくなる。

// ご利用の注意(9項目)。refs は詳しい説明のある質問の番号(複数可)。
// 区切り記号は言語で変わるため、faq.js 側でつなぐ
export const FAQ_NOTICES = [
  {
    text: {
      ja: 'このアプリは地図を表示するもので、道案内(ナビ)はしません。地図は常に北が上です。',
      en: 'This app shows a map. It does not give turn-by-turn directions. North is always up.'
    },
    refs: ['Q3', 'Q4']
  },
  {
    text: {
      ja: 'ハイキングルートは紙の地図をもとにした参考データです。実際の道と数十メートルずれることがあります。',
      en: 'Hiking routes are reference data drawn from a paper map. They can be off from the real trail by tens of metres.'
    },
    refs: ['Q5']
  },
  {
    text: {
      ja: 'ズームを上げるとずれが目立ちますが、データの精度が落ちるわけではありません。',
      en: 'Zooming in makes the gap more visible, but the data does not become less accurate.'
    },
    refs: ['Q7']
  },
  {
    text: {
      ja: '現在地は5〜10メートル、谷あいや樹林の中では数十メートルずれることがあります。',
      en: 'Your location is typically off by 5-10 metres, and by tens of metres in valleys or under trees.'
    },
    refs: ['Q9']
  },
  {
    text: {
      ja: '通行止めの表示が無いことは「通行できる」という意味ではありません。現地の標識を優先してください。',
      en: 'No closure shown does not mean the path is open. Always follow the signs on site.'
    },
    refs: ['Q13']
  },
  {
    text: {
      ja: '緊急ポイントは、救助を求めるときに居場所を伝えるための目印です。',
      en: 'Emergency points are landmarks for telling rescuers where you are.'
    },
    refs: ['Q15']
  },
  {
    text: {
      ja: '表示される情報は、電波のある場所で開いたときに受け取った内容です。入山前に一度開き直してください。',
      en: 'What you see is what the app received the last time you opened it with a signal. Reopen it before you set off.'
    },
    refs: ['Q16']
  },
  {
    text: {
      ja: '地図のダウンロード対象は、緊急ポイントやハイキングルートの周辺のみです。',
      en: 'Only the area around the emergency points and hiking routes is available for download.'
    },
    refs: ['Q17']
  },
  {
    text: {
      ja: '移動経路の記録中はスリープしないため、電池の消耗が早くなります。予備の電源をご用意ください。',
      en: 'While recording a track the device is kept from sleeping, so the battery drains faster. Bring a power bank.'
    },
    refs: ['Q19']
  }
];

// よくある質問。section ごとに質問をまとめ、a は段落の配列
export const FAQ_SECTIONS = [
  {
    title: { ja: 'このアプリについて', en: 'About This App' },
    items: [
      {
        id: 'Q1',
        q: { ja: 'これはどんなアプリですか。', en: 'What kind of app is this?' },
        a: [
          {
            ja: '箕面エリアの国土地理院地図に、緊急ポイント・ハイキングルート・スポット・通行止め地点を重ねて表示する地図アプリです。事前に地図を端末へ保存しておけば、電波の届かない山の中でも地図と現在地を確認できます。歩いた経路を記録して GPX ファイルに出力することもできます。',
            en: 'A map app that shows emergency points, hiking routes, spots and closures on top of the GSI map of the Minoh area. Save the map to your device beforehand and you can check the map and your location deep in the mountains with no signal. You can also record the route you walk and export it as a GPX file.'
          },
          {
            ja: 'インストールは不要で、Web ブラウザからそのまま使えます。',
            en: 'No installation is needed; it runs straight from a web browser.'
          }
        ]
      },
      {
        id: 'Q2',
        q: {
          ja: '費用はかかりますか。広告や、位置情報の送信はありますか。',
          en: 'Does it cost anything? Are there ads, or is my location sent anywhere?'
        },
        a: [
          {
            ja: '費用はかかりません。広告も表示しません。',
            en: 'There is no charge, and no ads are shown.'
          },
          {
            ja: '位置情報は、端末の中で地図の表示と経路の記録に使うだけです。外部へ送信したり、どこかに保存したりすることはありません。',
            en: 'Your location is used only on your device, to draw the map and record your track. It is never sent anywhere or stored outside your device.'
          }
        ]
      },
      {
        id: 'Q3',
        q: {
          ja: '目的地までの道案内(ナビ)はできますか。',
          en: 'Can it navigate me to a destination?'
        },
        a: [
          {
            ja: 'できません。本アプリは地図を表示するもので、ルート検索・曲がる方向の案内・音声案内は行いません。',
            en: 'No. This app displays a map; it does not search for routes, tell you where to turn, or give voice guidance.'
          }
        ]
      },
      {
        id: 'Q4',
        q: {
          ja: '現在進もうとしている方角は分かりますか。',
          en: 'Can I tell which way I am heading?'
        },
        a: [
          {
            ja: '端末をどちらへ向けているか(方位磁石のような表示)には対応していません。地図は常に北が上です。',
            en: 'There is no compass-style display of which way the device is pointing. North is always up on the map.'
          },
          {
            ja: 'ただし、移動経路の記録中は、現在地点に置かれる三角のマーカーが進行方向を向きます。向きは、直近3点までの記録点の平均の位置から、現在地点へ向かう方向として求めています(記録点は、約20メートル移動するか約1分ごとに追加されます)。',
            en: 'While a track is being recorded, however, the triangular marker at your position points the way you are travelling. The direction is the bearing from the average of the last three recorded points to your current position (a point is recorded after about 20 metres of movement, or about every minute).'
          },
          {
            ja: 'そのため、歩き始めた直後や、その場にとどまっているときは向きが定まらないことがあります。記録していないときは、この三角は表示されません。方角そのものを確かめたいときは、コンパスをご利用ください。',
            en: 'So the direction may be unsettled just after you start walking, or while you stand still. The triangle is not shown when you are not recording. To check a bearing itself, please use a compass.'
          }
        ]
      }
    ]
  },
  {
    title: { ja: '地図とルートのずれについて', en: 'Gaps Between the Map and the Trail' },
    items: [
      {
        id: 'Q5',
        q: {
          ja: 'ハイキングルートは、実際の道と同じ位置に表示されますか。',
          en: 'Are hiking routes drawn exactly where the real trail is?'
        },
        a: [
          { ja: '同じではありません。', en: 'No, they are not.' },
          {
            ja: '地図に重ねて表示するハイキングルートとスポットは、紙の地図をもとに作成した参考データです。そのため、実際の林道・ハイキング道とは数十メートル単位でずれることがあります。',
            en: 'The hiking routes and spots drawn on the map are reference data created from a paper map. They can therefore be off from the real forest roads and trails by tens of metres.'
          },
          {
            ja: 'ルートの線は、道の「おおよその位置とつながり」を示すものであり、正確な道の形ではありません。歩くときは、現地の道と標識を優先してください。',
            en: 'A route line shows roughly where a path runs and how it connects, not its exact shape. When walking, follow the trail and the signs on site.'
          }
        ]
      },
      {
        id: 'Q6',
        q: {
          ja: 'ルートが、実際に歩いている道とずれています。',
          en: 'The route does not line up with the trail I am walking on.'
        },
        a: [
          {
            ja: 'Q5 のとおり、ルートは紙の地図をもとにした参考データのため、ずれが出ることがあります。アプリの不具合ではありません。',
            en: 'As in Q5, routes are reference data from a paper map, so gaps do occur. This is not a fault in the app.'
          },
          {
            ja: 'なお、ずれには「ルート側のずれ(データの作成に由来するもの・Q5)」と「現在地側のずれ(GPS の誤差・Q9)」の2つが重なって出ることがあります。両方が同じ向きに出ると、実際よりかなり離れて見えることがあります。',
            en: 'Note that two gaps can add up: one on the route side (from how the data was made, Q5) and one on your location side (GPS error, Q9). When both lean the same way, the distance on screen can look much larger than it really is.'
          }
        ]
      },
      {
        id: 'Q7',
        q: {
          ja: 'ズームを上げると、ルートが道から大きく外れて見えます。ズームを上げると精度が落ちるのですか。',
          en: 'Zooming in makes the route look far off the trail. Does zooming in reduce the accuracy?'
        },
        a: [
          {
            ja: 'いいえ。ズームを上げても、データの精度は変わりません。ずれが目立つようになるだけです。',
            en: 'No. Zooming in does not change the accuracy of the data. It only makes the existing gap more visible.'
          },
          // 文書にある表(ズーム別の画素数)は狭い画面に置けないため、要点を文章にした
          {
            ja: '同じ 20 メートルのずれでも、画面上での見え方はズームによって変わります。起動時の z=15 では約5画素ですが、最大の z=18 では約41画素になります(箕面付近の緯度での目安)。z=15 では指の先ほどのずれでも、z=18 では画面の 1/4 近く離れて見えることがあります。',
            en: 'The same 20-metre gap looks different at different zoom levels. At z=15, the startup zoom, it is about 5 pixels; at z=18, the maximum, it is about 41 pixels (approximate, at the latitude of Minoh). What looks like a fingertip at z=15 can look like nearly a quarter of the screen at z=18.'
          },
          {
            ja: 'ルートと道の関係を大まかに確かめたいときは、ズームを下げた方が実態に近く見えます。現在のズームは画面右下に z=NN で表示されます(「設定/Settings」で表示を消せます)。',
            en: 'To get a general sense of how a route relates to the trail, zooming out gives a truer picture. The current zoom is shown as z=NN at the bottom right (you can hide it from 設定/Settings).'
          }
        ]
      },
      {
        id: 'Q8',
        q: {
          ja: '分岐が、ルートの表示と違う場所にありました。',
          en: 'A junction was in a different place from where the route showed it.'
        },
        a: [
          {
            ja: '分岐の位置や、細かな曲がりは実際と異なることがあります(Q5)。現地の道と標識でご判断ください。',
            en: 'The position of junctions and small bends can differ from reality (Q5). Please judge from the trail and the signs on site.'
          }
        ]
      }
    ]
  },
  {
    title: { ja: '現在地について', en: 'Your Location' },
    items: [
      {
        id: 'Q9',
        q: { ja: '現在地は、どのくらい正確ですか。', en: 'How accurate is my location?' },
        a: [
          {
            ja: 'スマートフォンの現在地は、5〜10 メートル程度の誤差があるのが普通です。',
            en: 'A smartphone location normally carries an error of about 5 to 10 metres.'
          },
          {
            ja: '谷あい・急斜面の下・樹林の中・崖のそばでは、空が見える範囲が狭くなって衛星をとらえにくくなるため、数十メートルずれることがあります。箕面の谷筋は特に注意が必要です。',
            en: 'In valleys, below steep slopes, under trees or beside cliffs, less sky is visible and fewer satellites can be reached, so the error can grow to tens of metres. The valleys of Minoh call for particular care.'
          },
          {
            ja: 'アプリを開いた直後や、しばらく使っていなかった後も、位置が定まるまで時間がかかります。',
            en: 'It also takes time for the position to settle just after you open the app, or after a while without using it.'
          },
          {
            ja: '誤差の大きさを画面に示す表示はありません。以前は「精度の目安の円」を表示していましたが、円の大きさが状況によって大きく変わり、何を表しているのかが伝わりにくかったため廃止しました。',
            en: 'There is no on-screen indicator of how large the error is. An accuracy circle used to be shown, but its size varied so much with conditions that what it meant was hard to read, so it was removed.'
          }
        ]
      },
      {
        id: 'Q10',
        q: {
          ja: '現在地が、道の外に表示されます。',
          en: 'My location appears off the trail.'
        },
        a: [
          {
            ja: '表示が道から外れていても、実際に道を外れているとは限りません。Q9 の誤差に加えて、ルート側のずれ(Q5)も重なるためです。逆に、道の上に表示されていても、実際は少し離れていることがあります。',
            en: 'Being drawn off the trail does not mean you have actually left it: the error in Q9 adds to the route-side gap in Q5. Conversely, being drawn on the trail does not guarantee you are exactly on it.'
          },
          {
            ja: '現在地の表示だけで進む方向を決めず、現地の道と標識をあわせてご確認ください。',
            en: 'Do not decide which way to go from the location display alone; check the trail and the signs on site as well.'
          }
        ]
      },
      {
        id: 'Q11',
        q: { ja: '現在地がなかなか表示されません。', en: 'My location is slow to appear.' },
        a: [
          {
            ja: '表示設定パネルの「現在地点をマーカー表示」がオンになっているか、位置情報の利用を許可しているかをご確認ください。',
            en: 'Check that "Show current location marker" is on in the display settings panel, and that you have allowed access to your location.'
          },
          {
            ja: '谷や樹林の中、屋内では位置の取得に時間がかかります。空が見える場所で少しお待ちください。端末を再起動すると、表示できるようになる場合があります。',
            en: 'Fixing a position takes longer in valleys, under trees and indoors. Please wait a moment somewhere with a view of the sky. Restarting the device sometimes makes it appear.'
          }
        ]
      },
      {
        id: 'Q12',
        q: {
          ja: '現在地のまわりの円がすぐ消えます。',
          en: 'The circle around my location disappears right away.'
        },
        a: [
          {
            ja: 'この円は、画面右下の現在地点を表示ボタンを押したときに3秒間だけ表示され、小さくなりながら消える仕様です。もう一度見たいときは、ボタンをもう一度押してください。',
            en: 'That is intended: pressing the show-current-location button at the bottom right displays the circle for three seconds while it shrinks away. Press the button again to see it once more.'
          }
        ]
      }
    ]
  },
  {
    title: { ja: '安全に関わること', en: 'Safety' },
    items: [
      {
        id: 'Q13',
        q: {
          ja: '通行止めの表示が無ければ、通れるということですか。',
          en: 'If no closure is shown, does that mean the path is open?'
        },
        a: [
          {
            ja: 'いいえ。表示が無いことは「通行できる」という意味ではありません。',
            en: 'No. The absence of a marker does not mean a path can be used.'
          },
          {
            ja: '表示している通行止め・通行困難地点は、公開された時点の情報です。新しく発生した崩落や倒木は反映されていません。',
            en: 'The closures and difficult points shown are as of the time they were published. Landslides and fallen trees that have happened since are not reflected.'
          },
          {
            ja: '現地の標識・掲示・ロープ・立入禁止の表示があれば、必ずそちらを優先してください。',
            en: 'Where there are signs, notices, ropes or no-entry markings on site, always follow those instead.'
          }
        ]
      },
      {
        id: 'Q14',
        q: {
          ja: '通行止めの情報が古い気がします。',
          en: 'The closure information looks out of date.'
        },
        a: [
          {
            ja: '表示は、電波のある場所でアプリを開いたときに最新へ更新されます。山の中では最後に受け取った内容のままです。',
            en: 'The display is refreshed when you open the app somewhere with a signal. In the mountains it stays as it was when last received.'
          },
          {
            ja: '登山口など、電波のある場所で一度アプリを開き直してください。',
            en: 'Please reopen the app somewhere with a signal, such as at the trailhead.'
          }
        ]
      },
      {
        id: 'Q15',
        q: {
          ja: '緊急ポイントには、避難できる設備がありますか。',
          en: 'Is there shelter or equipment at an emergency point?'
        },
        a: [
          {
            ja: '緊急ポイントは、救助を求めるときに自分の居場所を伝えるための目印です。',
            en: 'Emergency points are landmarks for telling rescuers where you are.'
          },
          {
            ja: '表示位置は目安であり、そこに設備や避難場所があること、そこへ到達できることを示すものではありません。',
            en: 'The marked position is approximate, and it does not indicate that facilities or shelter exist there, or that the place can be reached.'
          }
        ]
      },
      {
        id: 'Q16',
        q: {
          ja: '表示されている情報は、いつの時点のものですか。',
          en: 'How current is the information shown?'
        },
        a: [
          {
            ja: '地図もハイキングデータも、電波のある場所でアプリを開いたときに受け取った内容を表示します。電波の届かない山の中では、最後に受け取った内容のままです。',
            en: 'Both the map and the hiking data show what the app received when you last opened it with a signal. Where there is no signal, it stays as last received.'
          },
          {
            ja: '入山前に、電波のある場所で一度アプリを開き直してください。登山口で開くのが確実です。一度も電波のある場所で開いていない端末では、ポイントもルートも表示されません。',
            en: 'Please reopen the app with a signal before you set off; the trailhead is a reliable spot. On a device that has never been opened with a signal, neither points nor routes will appear.'
          }
        ]
      }
    ]
  },
  {
    title: { ja: '表示されない・見えない', en: 'Nothing Appears' },
    items: [
      {
        id: 'Q17',
        q: {
          ja: 'オフラインで、地図の一部が白く抜けます。',
          en: 'Parts of the map are blank when offline.'
        },
        a: [
          {
            ja: '地図のダウンロード対象は、箕面ハイキングマップの緊急ポイントやハイキングルートの周辺のみです。箕面エリア全体を覆っているわけではありません。ルートから離れた場所へ地図を動かすと、保存の対象外の範囲に入るため、オフラインでは白く抜けます。',
            en: 'Only the area around the emergency points and hiking routes of the Minoh Hiking Map is available for download; the whole Minoh area is not covered. Pan away from the routes and you leave the saved area, so the map is blank offline.'
          },
          {
            ja: 'ルートの周辺であれば、その範囲・ズームの地図がまだダウンロードされていない可能性があります。電波のある場所で「地図データのダウンロード」から取得してください。',
            en: 'If you are near a route, that area or zoom level may simply not be downloaded yet. Get it from "Download Map Data" somewhere with a signal.'
          },
          {
            ja: '細かい地図(Z=18)まで見たいときは、「詳細地図データ(Z=18)を含む」をオンにしてダウンロードします。',
            en: 'To see the finest map (Z=18), turn on "Include detailed map data (Z=18)" before downloading.'
          }
        ]
      },
      {
        id: 'Q18',
        q: {
          ja: 'ポイントやルートが、まったく表示されません。',
          en: 'No points or routes appear at all.'
        },
        a: [
          {
            ja: 'これらの情報はインターネットから受け取ります。一度も電波のある場所で開いていない端末では表示されません。',
            en: 'This information is received over the internet. It does not appear on a device that has never been opened with a signal.'
          },
          {
            ja: '電波のある場所でアプリを開き直してください。一度受け取れば、次からはオフラインでも表示されます。',
            en: 'Please reopen the app somewhere with a signal. Once received, it will appear offline from then on.'
          }
        ]
      }
    ]
  },
  {
    title: { ja: '移動経路の記録と電池', en: 'Track Recording and Battery' },
    items: [
      {
        id: 'Q19',
        q: {
          ja: '記録中に、電池の減りが早いです。',
          en: 'The battery drains quickly while recording.'
        },
        a: [
          {
            ja: '移動経路の記録中は、位置の取得が止まらないようスリープしないようにしています。そのぶん電池の消耗が早くなります。',
            en: 'While a track is being recorded the device is kept from sleeping, so that position updates do not stop. That is what makes the battery drain faster.'
          },
          {
            ja: '記録が終わったら停止してください。山中での電池切れは、地図も現在地も使えなくなることを意味します。予備の電源の携行をおすすめします。',
            en: 'Please stop recording when you are done. A flat battery in the mountains means losing both the map and your location, so carrying a power bank is recommended.'
          }
        ]
      },
      {
        id: 'Q20',
        q: {
          ja: '記録した経路は、アプリに保存されますか。',
          en: 'Is the recorded track saved in the app?'
        },
        a: [
          {
            ja: '最新の経路のみ、端末のアプリ内にデータとして保存されます。アプリを削除すると、データも削除します。',
            en: 'Only the most recent track is stored as data inside the app on your device. Deleting the app also deletes that data.'
          },
          {
            ja: '残しておきたいときは、「出力」で GPX ファイルに保存してください。保存したファイルは「読み込み」で地図に戻せます。',
            en: 'To keep it, save it as a GPX file with "Export". A saved file can be put back on the map with "Import".'
          }
        ]
      },
      {
        id: 'Q21',
        q: {
          ja: '記録中に画面が消えて、経路が飛んでしまいました。',
          en: 'The screen went off while recording and the track has a gap.'
        },
        a: [
          {
            ja: '記録中は画面が消えないようにしていますが、端末によっては省電力設定などで消灯することがあります。他のアプリに切り替えていた間も位置は取得できません。アプリに戻ると記録を再開します。',
            en: 'The screen is kept on while recording, but on some devices power-saving settings can still turn it off. Positions are also not received while you are in another app. Recording resumes when you return to the app.'
          }
        ]
      },
      {
        id: 'Q22',
        q: {
          ja: '前に記録した経路と、今日歩いた経路を並べて見たいです。',
          en: 'I want to see a previously recorded track alongside the one from today.'
        },
        a: [
          {
            ja: '前の経路を「読み込み」で表示してから記録を始め、確認画面で「追加して記録開始」を選んでください。',
            en: 'Display the earlier track with "Import", then start recording and choose "Add a route and start recording" on the confirmation screen.'
          },
          {
            ja: '経路が「経路 1」「経路 2」として別々に残り、それぞれの地点数・移動距離が表示されます。',
            en: 'The tracks are kept separately as "Route 1" and "Route 2", each with its own number of points and distance.'
          }
        ]
      }
    ]
  },
  {
    title: { ja: 'その他', en: 'Other' },
    items: [
      {
        id: 'Q23',
        q: {
          ja: '地図やルートは、誰が作っているのですか。',
          en: 'Who makes the map and the routes?'
        },
        a: [
          {
            ja: '地図は国土地理院の地図タイルです。ハイキングルート・スポット・緊急ポイント・通行止め地点は、本アプリの運営に関わる有志が作成・公開しています。',
            en: 'The map is made of tiles from the Geospatial Information Authority of Japan (GSI). The hiking routes, spots, emergency points and closures are created and published by volunteers involved in running this app.'
          },
          {
            ja: '詳細は「設定/Settings」の「このアプリについて」をご参照ください。',
            en: 'For details, see "About this app" in 設定/Settings.'
          }
        ]
      },
      {
        id: 'Q24',
        q: {
          ja: '地図やアプリのバージョンを確認したいです。',
          en: 'I want to check the map and app versions.'
        },
        a: [
          {
            ja: 'ホーム画面の「バージョン情報」で、アプリバージョン・国土地理院地図タイル・ハイキングマップ・通行止め地点のバージョンと、各データの件数を確認できます。',
            en: '"Version Info" on the start screen shows the versions of the app, the GSI map tiles, the hiking map and the closure data, along with how many items each holds.'
          }
        ]
      },
      {
        id: 'Q25',
        q: {
          ja: '端末の空き容量を増やしたいです。',
          en: 'I want to free up space on my device.'
        },
        a: [
          {
            ja: '「地図データのダウンロード」画面の「クリア」で、保存済みの地図データを削除できます(確認が表示されます)。詳細地図データを含めても合計 約 14.1 MB です。',
            en: '"Clear" on the "Download Map Data" screen deletes the saved map data (you will be asked to confirm). Even with the detailed map data included, the total is about 14.1 MB.'
          }
        ]
      },
      {
        id: 'Q26',
        q: {
          ja: '英語表示にしたら、戻し方が分からなくなりました。',
          en: 'I switched to English and cannot find my way back.'
        },
        a: [
          {
            ja: 'ホーム画面の「設定/Settings」(日英併記のまま変わりません)を開き、「言語の設定/Language Settings」で「日本語」を選んでください。',
            en: 'Open 設定/Settings on the start screen (this label stays in both languages) and choose 日本語 under 言語の設定/Language Settings.'
          }
        ]
      }
    ]
  }
];
