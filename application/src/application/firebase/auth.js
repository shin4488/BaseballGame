import firebase from 'firebase/app';
import 'firebase/auth';
import 'regenerator-runtime/runtime.js';

/**
 * firebaseハンドラー
 */
export class FirebaseAuth {
  /**
   * ログイン状態の変更検知処理
   * @returns
   */
  async watchStateChanged() {
    return new window.Promise((resolve) => {
      firebase.auth().onAuthStateChanged((user) => {
        if (user === null) {
          this.clear();
          resolve();
          return;
        }

        this._loginUserId = user.uid;
        this._loginUserName = user.displayName;
        this._loginUserIconImage = user.photoURL;
        resolve();
      });
    });
  }

  /**
   * Googleログイン処理
   */
  async signInWithPopupToGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();

    try {
      const loginUserData = await firebase.auth().signInWithPopup(provider);
      this._loginUserId = loginUserData.user.uid;
      this._loginUserName = loginUserData.user.displayName;
      this._loginUserIconImage = loginUserData.user.photoURL;
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * ログアウト処理
   */
  async signOutFromGoogle() {
    await firebase.auth().signOut();
  }

  getLoginUserId() {
    return this._loginUserId;
  }

  getLoginUserName() {
    return this._loginUserName;
  }

  getLoginUserIconImage() {
    return this._loginUserIconImage;
  }

  isLoggedIn() {
    return this._loginUserId !== null;
  }

  clear() {
    this._loginUserId = null;
    this._loginUserName = null;
    this._loginUserIconImage = null;
  }
}

export class FirebaseAuthExtention {
  static auth;

  /**
   * 初期化処理
   */
  static async init() {
    FirebaseAuthExtention.auth = new FirebaseAuth();
    await FirebaseAuthExtention.auth.watchStateChanged();
  }
}
