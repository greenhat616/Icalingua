import { AtElem, FriendInfo, GroupMessageEventData, MemberBaseInfo, MessageElem } from 'oicq'
import Message from '../../types/Message'
import oicq from '../adapters/oicqAdapter'
import { base64decode } from 'nodejs-base64'
import mime from '../../utils/mime'
import path from 'path'
import LastMessage from '../../types/LastMessage'
import BilibiliMiniApp from '../../types/BilibiliMiniApp'
import StructMessageCard from '../../types/StructMessageCard'
import silkDecode from './silkDecode'
import errorHandler from './errorHandler'
import getImageUrlByMd5 from '../../utils/getImageUrlByMd5'

const processMessage = async (
    oicqMessage: MessageElem[],
    message: Message,
    lastMessage: LastMessage,
    roomId = null,
) => {
    if (!Array.isArray(oicqMessage)) oicqMessage = [oicqMessage]

    lastMessage.content = lastMessage.content ?? '' // 初始化最近信息内容

    let lastType
    for (let i = 0; i < oicqMessage.length; i++) {
        const m = oicqMessage[i]
        let appurl
        let url
        switch (m.type) {
            case 'at':
                if (lastType === 'reply') break
            // noinspection FallThroughInSwitchStatementJS 确信
            case 'text':
                lastMessage.content += m.data.text
                message.content += m.data.text
                if ((m as AtElem).data.qq === 'all' && message.senderId !== 2854196310) {
                    message.at = 'all'
                } else if ((m as AtElem).data.qq == oicq.getUin()) {
                    message.at = true
                }
                break
            case 'flash':
                message.flash = true
            // noinspection FallThroughInSwitchStatementJS 确信
            case 'image':
                lastMessage.content += '[Image]'
                url = m.data.url
                if (typeof m.data.file === 'string' && url.includes('c2cpicdw.qpic.cn')) {
                    const md5 = m.data.file.substr(0, 32)
                    ;/^([a-f\d]{32}|[A-F\d]{32})$/.test(md5) && (url = getImageUrlByMd5(md5))
                }
                message.file = {
                    type: 'image/jpeg',
                    url,
                }
                message.files.push(message.file)
                break
            case 'bface':
                lastMessage.content += '[Sticker]' + m.data.text
                url = `https://gxh.vip.qq.com/club/item/parcel/item/${m.data.file.substr(0, 2)}/${m.data.file.substr(
                    0,
                    32,
                )}/300x300.png`
                message.file = {
                    type: 'image/webp',
                    url,
                }
                message.files.push(message.file)
                break
            case 'file':
                lastMessage.content += '[File]' + m.data.name
                message.content += m.data.name
                message.file = {
                    type: mime(path.extname(m.data.name)),
                    size: m.data.size,
                    url: m.data.url,
                    name: m.data.name,
                    fid: m.data.fid,
                }
                message.files.push(message.file)
                break
            case 'share':
                lastMessage.content += '[Link]' + m.data.title
                message.content += m.data.url
                break
            case 'reply':
                let replyMessage: Message
                if (roomId) {
                    replyMessage = await oicq.getMessageFromStorage(roomId, m.data.id)
                }
                if (!replyMessage) {
                    //get the message
                    const getRet = await oicq.getMsg(m.data.id)
                    if (getRet.data) {
                        //获取到库里面还没有的历史消息
                        //暂时先不加回库里了
                        const data = getRet.data
                        const senderName =
                            'group_id' in data
                                ? (data as GroupMessageEventData).anonymous
                                    ? (data as GroupMessageEventData).anonymous.name
                                    : oicq.getUin() === data.sender.user_id
                                    ? 'You'
                                    : (data.sender as MemberBaseInfo).card || data.sender.nickname
                                : (data.sender as FriendInfo).remark || data.sender.nickname
                        replyMessage = {
                            _id: '',
                            date: '',
                            senderId: 0,
                            timestamp: '',
                            username: senderName,
                            content: '',
                            files: [],
                        }
                        await processMessage(data.message, replyMessage, {})
                    }
                }
                if (replyMessage) {
                    message.replyMessage = {
                        _id: m.data.id,
                        username: replyMessage.username,
                        content: replyMessage.content,
                        files: [],
                    }
                    if (replyMessage.file) {
                        //兼容旧版本
                        message.replyMessage.file = replyMessage.file
                    }
                    if (replyMessage.files) {
                        message.replyMessage.files = replyMessage.files
                    }
                    if (replyMessage.senderId === oicq.getUin()) message.at = true
                }
                break
            case 'json':
                const json: string = m.data.data
                message.code = json
                const jsonObj = JSON.parse(json)
                if (jsonObj.app === 'com.tencent.mannounce') {
                    try {
                        const title = base64decode(jsonObj.meta.mannounce.title)
                        const content = base64decode(jsonObj.meta.mannounce.text)
                        lastMessage.content = `[${title}]`
                        message.content = title + '\n\n' + content
                        break
                    } catch (err) {}
                }
                const biliRegex = /(https?:\\?\/\\?\/b23\.tv\\?\/\w*)\??/
                const zhihuRegex = /(https?:\\?\/\\?\/\w*\.?zhihu\.com\\?\/[^?"=]*)\??/
                const biliRegex2 = /(https?:\\?\/\\?\/\w*\.?bilibili\.com\\?\/[^?"=]*)\??/
                const jsonLinkRegex = /{.*"app":"com.tencent.structmsg".*"jumpUrl":"(https?:\\?\/\\?\/[^",]*)".*}/
                const jsonAppLinkRegex = /"contentJumpUrl": ?"(https?:\\?\/\\?\/[^",]*)"/
                if (biliRegex.test(json)) appurl = json.match(biliRegex)[1].replace(/\\\//g, '/')
                else if (biliRegex2.test(json)) appurl = json.match(biliRegex2)[1].replace(/\\\//g, '/')
                else if (zhihuRegex.test(json)) appurl = json.match(zhihuRegex)[1].replace(/\\\//g, '/')
                else if (jsonLinkRegex.test(json)) appurl = json.match(jsonLinkRegex)[1].replace(/\\\//g, '/')
                else if (jsonAppLinkRegex.test(json)) appurl = json.match(jsonAppLinkRegex)[1].replace(/\\\//g, '/')
                else {
                    //作为一般通过小程序解析内部 URL，像腾讯文档就可以
                    try {
                        const meta = (<BilibiliMiniApp>jsonObj).meta.detail_1
                        appurl = meta.qqdocurl
                    } catch (e) {}
                }
                if (appurl) {
                    try {
                        const meta = (<BilibiliMiniApp>jsonObj).meta.detail_1 || (<StructMessageCard>jsonObj).meta.news
                        lastMessage.content = meta.desc + ' '
                        message.content = meta.desc + '\n\n'

                        let previewUrl = meta.preview
                        if (!previewUrl.toLowerCase().startsWith('http')) {
                            previewUrl = 'https://' + previewUrl
                        }
                        message.file = {
                            type: 'image/jpeg',
                            url: previewUrl,
                        }
                        message.files.push(message.file)
                    } catch (e) {}

                    lastMessage.content += appurl
                    message.content += appurl
                } else {
                    lastMessage.content = '[JSON]'
                    message.content = '[JSON]'
                }
                break
            case 'xml':
                message.code = m.data.data
                const urlRegex = /url="([^"]+)"/
                const md5ImageRegex = /image [^<>]*md5="([A-F\d]{32})"/
                if (urlRegex.test(m.data.data)) appurl = m.data.data.match(urlRegex)[1].replace(/\\\//g, '/')
                if (m.data.data.includes('action="viewMultiMsg"')) {
                    lastMessage.content += '[Forward multiple messages]'
                    message.content += '[Forward multiple messages]'
                    const resIdRegex = /m_resid="([\w+=/]+)"/
                    if (resIdRegex.test(m.data.data)) {
                        const resId = m.data.data.match(resIdRegex)[1]
                        console.log(resId)
                        message.content = `[Forward: ${resId}]`
                    }
                } else if (appurl) {
                    appurl = appurl.replace(/&amp;/g, '&')
                    lastMessage.content = appurl
                    message.content = appurl
                } else if (md5ImageRegex.test(m.data.data)) {
                    const imgMd5 = (appurl = m.data.data.match(md5ImageRegex)[1])
                    lastMessage.content += '[Image]'
                    url = getImageUrlByMd5(imgMd5)
                    message.file = {
                        type: 'image/jpeg',
                        url,
                    }
                    message.files.push(message.file)
                } else {
                    lastMessage.content += '[XML]'
                    message.content += '[XML]'
                }
                break
            case 'face':
                message.content += `[Face: ${m.data.id}]`
                lastMessage.content += `[${m.data.text ? m.data.text : '表情'}]`
                break
            case 'video':
                message.content = ''
                lastMessage.content = `[Video]`
                message.file = {
                    type: 'video/mp4',
                    url: m.data.url,
                }
                message.files.push(message.file)
                break
            case 'record':
                try {
                    message.file = {
                        type: 'audio/mp3',
                        url: await silkDecode(m.data.url),
                    }
                    message.files.push(message.file)
                } catch (e) {
                    errorHandler(e, true)
                    message.code = JSON.stringify(e)
                    message.content = '[语音下载失败]'
                }
                lastMessage.content = '[Audio]'
                break
            case 'mirai':
                try {
                    message.mirai = JSON.parse(m.data.data)
                    if (!message.mirai.eqq) {
                        message.mirai = null
                        break
                    } else if (message.mirai.eqq.type === 'tg') {
                        const index = message.content.indexOf('：\n')
                        let sender = ''
                        if (index > -1) {
                            sender = message.content.substr(0, index)
                            message.content = message.content.substr(index + 2)
                        } else {
                            //是图片之类没有真实文本内容的
                            //去除尾部：
                            sender = message.content.substr(0, message.content.length - 1)
                            message.content = ''
                        }
                        message.username = lastMessage.username = sender
                        lastMessage.content = lastMessage.content.substr(sender.length + 1)
                    }
                } catch (e) {}
                break
        }
        lastType = m.type
    }
    return { message, lastMessage }
}

export default processMessage
