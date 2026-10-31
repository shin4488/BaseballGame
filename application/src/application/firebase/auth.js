import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth';

export class FirebaseAuth {
  /**
   * Firebase Authenticationがログイン状態を確定させた最初の通知まで待つ。
   * 以降のログイン・ログアウトの通知でも、保持するユーザー情報を更新し続ける。
   */
  async watchStateChanged() {
    return new window.Promise((resolve) => {
      onAuthStateChanged(getAuth(), (user) => {
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

  async signInWithPopupToGoogle() {
    const provider = new GoogleAuthProvider();

    try {
      const loginUserData = await signInWithPopup(getAuth(), provider);
      this._loginUserId = loginUserData.user.uid;
      this._loginUserName = loginUserData.user.displayName;
      this._loginUserIconImage = loginUserData.user.photoURL;
    } catch (error) {
      throw new Error(error.message, { cause: error });
    }
  }

  async signOutFromGoogle() {
    await signOut(getAuth());
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

  static async init() {
    FirebaseAuthExtention.auth = new FirebaseAuth();
    await FirebaseAuthExtention.auth.watchStateChanged();
  }
}
