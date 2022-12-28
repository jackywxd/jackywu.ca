const projectsData = [
  {
    title: 'AutoSender',
    description: `I was responsibled for overall architecture, backend API development and operations. The iOS App was developed by a team based in China, while the Android App was developed by a team based in India.

    ### AutoSender app provides below major features
    
    - Automatically or manually send delayed text or picture messages (SMS or MMS)
    - An in-app mobile number (Private Number) in the United States or Canada to send/receive SMS/MMS automatically
    - Incoming text auto reply, and text auto forwarding
    - Shared the mobile line by different iOS devices
    - Unlimited cloud storage and unlimited group messaging
    - Very reliable delivery of text messages`,
    imgSrc: '/static/images/autosender.webp',
    href: 'https://apps.apple.com/ca/app/autosender-automatic-texting/id1375015129',
  },
  {
    title: 'Refresh tokens hooks for Feathers',
    description: `Forked from [TheSinding/authentication-refresh-token](https://github.com/TheSinding/authentication-refresh-token)
    There are three major differences of my implementation:
    
    1. Implement refresh token via Feathers standalone service
    2. The form of refresh token is actual JWT
    3. Support all authentication strategies (local, oAuth)
    4. Support multi-devices login`,
    imgSrc: '/static/images/time-machine.jpg',
    href: 'https://www.npmjs.com/package/@jackywxd/feathers-refresh-token',
  },
  {
    title: 'AutoText',
    description: `AutoText is modern design scheduled messages mobile App. It came out from a pet project which I used to learn Mobile development and Google Firebase platform.

    ### Key features of AutoText
    
    AutoText can turn any device into full feature cell phone without a SIM card. You can make/receive phone calls! Auto or manually send SMS/MMS, and receive SMS, auto reply incoming message/calls, auto forward to other phone numbers or email for FREE!
    
    Not only can you send greeting text messaging, birthday reminders or appointment reminders, you can do much more:
    
    - SHARED LINE. Simply login with the same account from multiple devices all can enjoy the full features and shared the same phone number
    
    - VIRTUAL SIM. AutoText turns any iOS devices without a physical SIM into a fully feature phone in which can make/receive phone calls and send/receive SMS/MMS
    
    - US/CANADA PRESENCE. Without physically live in US/Canada, a private number can receive SMS verification code like you live in US/Canada
    
    - SEND GOUP MESSAGES AUTOMATICALLY. You can schedule and send messages to a group of recipients automatically
    
    - SCHEDULE MESSAGE REMINDERS. Write and schedule your message and your message will be sent at the scheduled time
    
    - SEND APPOINTMENT REMINDERS, INCREASE CUSTOMER RETENTION. You can be a better business by sending prewritten messages to your clients, staff or network automatically. You can schedule and auto send appointment reminders, meeting reminders or other messages to individuals as well as groups`,
    imgSrc: '/static/images/autotext-logo.png',
    href: 'https://autotext.mobi',
  },
  {
    title: 'AllConncect VPN',
    description: `Innovative Elastic VPN Cloud solution by combing the enterprise VPN Client and Cloud VPN backend.

    ## AnyConnect Client + Cloud VPN Server = AllConnect
    
    ### Features:
    
    - AllConnect VPN is a distributed Cloud VPN platform built upon with latest tech stacks and various open-sources projects
    - The innovative client-less and disposable VPN server design, PKI-based authentication bring the maximum security to normal people
    - Control plane is a cloud-native system implementation with various AWS services, including Lambda, API Gateway, DynamoDB, SES and etc
    - Data plane is based on OpenConnect server hosted in VPS and AnyConnect Client
    - Subscription business model is implemented with Stripe Payments and Billings`,
    imgSrc: '/static/2020/allconnect-logo.png',
    href: 'https://getallconnect.com',
  },
]

export default projectsData
