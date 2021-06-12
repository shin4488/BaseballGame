import firebase from 'firebase/app';
import 'firebase/firestore';

/**
 * firestoreのランキングコレクションのカラム
 */
export class FireStoreColumn {
  static userId = 'userId';
  static userName = 'userName';
  static userIconImageUrl = 'userIconImageUrl';
  static point = 'point';
  static lastUpdated = 'lastUpdated';
}

/**
 * firestoreのCRUD処理クラス
 */
export class FireStore {
  _firestore;
  _collection;

  constructor(firestore, collection) {
    this._firestore = firestore;
    this._collection = collection;
  }

  // データ検索
  /**
   * 今週のランキング検索
   * @returns
   */
  async getRankingThisWeek() {
    try {
      const topRanking = await this._firestore
        .collection(this._collection)
        .orderBy(FireStoreColumn.point, 'desc')
        .get();
      if (topRanking.docs.length === 0) {
        return [];
      }

      const topRankingPoint = topRanking.docs[0].data()[FireStoreColumn.point];
      const basisDate = new Date();
      basisDate.setDate(basisDate.getDate() - 7);

      // startAtで(得点, 日付)の順で指定すると想定通りの挙動をしないため、(日付, 得点)の順で指定している
      // 日付順を得点順より優先してしまっているため、limitを付けると日付が最近でランキング上位者が取得されなくなる
      const guests = await this._firestore
        .collection(this._collection)
        .orderBy(FireStoreColumn.lastUpdated)
        .orderBy(FireStoreColumn.point, 'desc')
        .startAt(basisDate, topRankingPoint)
        .get();

      return guests.docs
        .map((x) => x.data())
        .filter((x) => x[FireStoreColumn.point] >= 0);
    } catch (error) {
      throw new Error('Ranking Fetch Error1');
    }
  }

  /**
   * 歴代のランキング検索
   * @returns
   */
  async getRankingHistory() {
    try {
      const guests = await this._firestore
        .collection(this._collection)
        .orderBy(FireStoreColumn.point, 'desc')
        .orderBy(FireStoreColumn.lastUpdated)
        .limit(10)
        .get();

      return guests.docs.map((x) => x.data());
    } catch (error) {
      throw new Error('Ranking Fetch Error2');
    }
  }

  /**
   * 任意のユーザIDを生成します
   * ゲストユーザにのみ使用してください
   * @returns
   */
  async createUserId() {
    try {
      const randomSize = 10;
      const zeros = [...Array(randomSize)].map(() => '0');

      // ゲストユーザのユーザIDを生成
      const guestCount = (
        await this._firestore.collection(this._collection).get()
      ).size;
      const guestCountWithPadding = `${zeros.join('')}${guestCount + 1}`.slice(
        -randomSize,
      );
      const randomString = Math.random().toString(36).slice(-randomSize);

      // 一時的にゲストユーザドキュメントを生成
      // 他のユーザとゲストユーザのユーザIDの重複を防ぐため
      this.upsertRanking({
        documentId: `${guestCountWithPadding}${randomString}`,
      });

      return { guestCountWithPadding, randomString };
    } catch (error) {
      throw new Error('Create Id Error');
    }
  }

  /**
   * データ更新
   * upsertでランキングデータを追加
   * @param {*} parameter
   */
  async upsertRanking(parameter) {
    const documentId = parameter.documentId;
    const targetData = {
      [FireStoreColumn.userId]: documentId,
      [FireStoreColumn.userName]: parameter.userName,
      [FireStoreColumn.userIconImageUrl]: parameter.userIconImageUrl,
      [FireStoreColumn.point]: parameter.point,
      [FireStoreColumn.lastUpdated]: new Date(),
    };

    // 本来同じユーザの歴代記録は残したいところだが、自分が何度もプレーしているのがばれたくないため記録は上書きする
    await this._firestore
      .collection(this._collection)
      .doc(documentId)
      .set(targetData, { merge: true });
  }

  /**
   * ランキングの削除
   * @param {*} documentId
   */
  async deleteRanking(documentId) {
    await this._firestore.collection(this._collection).doc(documentId).delete();
  }
}

/**
 * firestoreのCRUD処理の拡張クラス
 */
export class FireStoreExtention {
  static loginUserStore;
  static guestStore;

  static init() {
    const firestore = firebase.firestore();
    firestore.settings({
      ignoreUndefinedProperties: true,
      merge: true,
    });
    FireStoreExtention.guestStore = new FireStore(firestore, 'guests');
    FireStoreExtention.loginUserStore = new FireStore(firestore, 'loginUsers');
  }

  /**
   * 歴代のランキングの取得
   */
  static async getRankingHistory() {
    const guestRankingList =
      await FireStoreExtention.guestStore.getRankingHistory();
    const loginUserRankingList =
      await FireStoreExtention.loginUserStore.getRankingHistory();

    const rankingList = guestRankingList.concat(loginUserRankingList);
    const sortedRankingTop10List =
      FireStoreExtention.sortByRankingLastUpdated(rankingList);

    return sortedRankingTop10List;
  }

  /**
   * 今週のランキングの取得
   */
  static async getRankingThisWeek() {
    const guestRankingList =
      await FireStoreExtention.guestStore.getRankingThisWeek();
    const loginUserRankingList =
      await FireStoreExtention.loginUserStore.getRankingThisWeek();

    const rankingList = guestRankingList.concat(loginUserRankingList);
    const sortedRankingTop10List =
      FireStoreExtention.sortByRankingLastUpdated(rankingList);

    return sortedRankingTop10List;
  }

  /**
   * ランキングで並び替え
   * @param {*} rankingList
   */
  static sortByRankingLastUpdated(rankingList) {
    // 参照渡しによる上書きを防ぐ
    // ソートの優先順位を「得点」「最終更新日時」とする
    const sortedRankingList = [...rankingList]
      .sort(
        (next, previous) =>
          (previous[FireStoreColumn.lastUpdated] -
            next[FireStoreColumn.lastUpdated]) *
          -1,
      )
      .sort(
        (next, previous) =>
          previous[FireStoreColumn.point] - next[FireStoreColumn.point],
      );

    return sortedRankingList.slice(0, 10);
  }
}
