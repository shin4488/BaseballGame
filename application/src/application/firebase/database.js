import {
  initializeFirestore,
  collection,
  query,
  orderBy,
  startAt,
  limit,
  getDocs,
  getDocsFromServer,
  runTransaction,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';

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
      const basisDate = new Date();
      basisDate.setDate(basisDate.getDate() - 7);

      // 7日前以降を取得し、全体を得点順に並べてから上位10件に絞る。
      // 日付順を得点順より優先してしまっているため、limitを付けると日付が最近でランキング上位者が取得されなくなる
      const guests = await getDocs(
        query(
          collection(this._firestore, this._collection),
          orderBy(FireStoreColumn.lastUpdated),
          orderBy(FireStoreColumn.point, 'desc'),
          startAt(basisDate),
        ),
      );

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
      const guests = await getDocs(
        query(
          collection(this._firestore, this._collection),
          orderBy(FireStoreColumn.point, 'desc'),
          orderBy(FireStoreColumn.lastUpdated),
          limit(10),
        ),
      );

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
      // IDの推測を防ぐ乱数は維持し、表示番号だけを共有カウンターで発番する。
      const randomBytes = window.crypto.getRandomValues(new Uint8Array(16));
      const randomString = Array.from(randomBytes, (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const counterRef = doc(this._firestore, this._collection, '_sequence');
      const guestNumber = await runTransaction(this._firestore, async (tx) => {
        const counter = await tx.get(counterRef);
        let lastNumber;
        if (counter.exists()) {
          lastNumber = counter.data().lastNumber;
        } else {
          // 初回のみ、過去の10桁ゼロ埋めIDの最大番号を1件取得する。
          // 件数から発番しないため、過去の記録が削除されても番号を再利用しない。
          const latest = await getDocsFromServer(
            query(
              collection(this._firestore, this._collection),
              orderBy(FireStoreColumn.userId, 'desc'),
              limit(1),
            ),
          );
          const latestId = latest.docs[0]?.data()[FireStoreColumn.userId];
          if (latestId !== undefined && !/^\d{10}.+$/.test(latestId)) {
            throw new Error('Invalid guest ID');
          }
          lastNumber = latestId === undefined ? 0 : Number(latestId.slice(0, 10));
        }
        if (
          !Number.isSafeInteger(lastNumber) ||
          lastNumber < 0 ||
          lastNumber >= 9999999999
        ) {
          throw new Error('Invalid guest sequence');
        }
        const nextNumber = lastNumber + 1;
        // ランキング用フィールドを持たせず、ランキングの検索対象から除外する。
        tx.set(counterRef, { lastNumber: nextNumber });
        return nextNumber;
      });
      const guestNumberWithPadding = String(guestNumber).padStart(10, '0');
      return { guestNumberWithPadding, randomString };
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
    await setDoc(
      doc(this._firestore, this._collection, documentId),
      targetData,
      { merge: true },
    );
  }

  /**
   * ランキングの削除
   * @param {*} documentId
   */
  async deleteRanking(documentId) {
    await deleteDoc(doc(this._firestore, this._collection, documentId));
  }
}

/**
 * firestoreのCRUD処理の拡張クラス
 */
export class FireStoreExtention {
  static loginUserStore;
  static guestStore;

  static init() {
    const firestore = initializeFirestore(getApp(), {
      ignoreUndefinedProperties: true,
    });
    FireStoreExtention.guestStore = new FireStore(firestore, 'guests');
    FireStoreExtention.loginUserStore = new FireStore(firestore, 'loginUsers');
  }

  /**
   * 歴代のランキングの取得
   */
  static async getRankingHistory() {
    const [guestRankingList, loginUserRankingList] = await Promise.all([
      FireStoreExtention.guestStore.getRankingHistory(),
      FireStoreExtention.loginUserStore.getRankingHistory(),
    ]);

    const rankingList = guestRankingList.concat(loginUserRankingList);
    const sortedRankingTop10List =
      FireStoreExtention.sortByRankingLastUpdated(rankingList);

    return sortedRankingTop10List;
  }

  /**
   * 今週のランキングの取得
   */
  static async getRankingThisWeek() {
    const [guestRankingList, loginUserRankingList] = await Promise.all([
      FireStoreExtention.guestStore.getRankingThisWeek(),
      FireStoreExtention.loginUserStore.getRankingThisWeek(),
    ]);

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
