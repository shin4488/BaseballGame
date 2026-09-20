// ブラウザ確認専用。Firebase SDKを読み込まず、データはメモリ内にだけ保持する。
let user = null;
let guestNumber = 700;
const rankings = [];
export const FireStoreColumn = Object.fromEntries(
  ['userId', 'userName', 'userIconImageUrl', 'point', 'lastUpdated'].map(key => [key, key]),
);
const store = {
  async createUserId() {
    guestNumber += 1;
    return {guestNumberWithPadding: String(guestNumber).padStart(10, '0'), randomString: 'ab'.repeat(16)};
  },
  async upsertRanking(data) {
    const index = rankings.findIndex(row => row.userId === data.documentId);
    if (index >= 0) rankings.splice(index, 1);
    rankings.push({...data, userId:data.documentId, lastUpdated:{toDate:()=>new Date()}});
  },
  async deleteRanking(id) {
    const index = rankings.findIndex(row => row.userId === id);
    if (index >= 0) rankings.splice(index, 1);
  },
};
export class FireStoreExtention {
  static guestStore = store;
  static loginUserStore = store;
  static async getRankingHistory() { return rankings.slice().sort((a,b)=>b.point-a.point); }
  static async getRankingThisWeek() { return this.getRankingHistory(); }
}
export class FirebaseAuthExtention {
  static auth = {
    isLoggedIn: () => user !== null,
    getLoginUserId: () => user?.id || null,
    getLoginUserName: () => user?.name || null,
    getLoginUserIconImage: () => './image/guest.png',
    async signOutFromGoogle() { user = null; },
    async signInWithPopupToGoogle() {
      user = {id:'offline-player',name:'表示確認用の長いプレイヤー名（ローカルテスト）'};
    },
  };
}
export class FirebaseInit { static async init() {} }
