import Vector2 from '../vector/vector2';
import { FirebaseAuthExtention } from '../firebase/auth';
import { FireStoreExtention, FireStoreColumn } from '../firebase/database';
import {
  isHitCircleToLine,
  getResultMessage,
  getRandomNumber,
} from './process';
import { boardItems, guestImagePath } from './appConfig';
import 'regenerator-runtime/runtime.js';

export const createVueInstance = () => {
  return new Vue({
    el: '#app',
    computed: {
      moundStyleComputed() {
        return `width: ${this.moundSize}px; height: ${this.moundSize}px;
          top: ${this.moundYPositionComputed}px;`;
      },
      ballStyleComputed() {
        return `width: ${this.ballSize}px; height: ${this.ballSize}px;
          top: ${this.ballYPositionComputed}px;
          transform: translate(${this.xBallPosition}px, ${this.yBallPosition}px);`;
      },
      batStyleComputed() {
        return `width: ${this.batInitWidth}px; height: ${this.batInitHeight}px;
          left: ${this.batXPositionComputed}px; top: ${this.batYPositionComputed}px;
          transform: rotate(${this.batRotateDegree}deg);
          transform-origin: ${this.batInitWidth}px 0;`;
      },
      hitButtonStyleComputed() {
        return `top: ${this.hitButtonYPositionComputed}px;`;
      },
      boardItemStyleComputed() {
        return `border-bottom: ${this.ballSize}px solid;
          line-height: ${this.ballSize}px;`;
      },
      resultBoardStyleComputed() {
        return `left: ${-window.document.documentElement.clientWidth / 1.31}px;
          top: ${window.document.documentElement.clientHeight - 80}px;`;
      },
      playingResultStyleComputed() {
        return `top: ${window.document.documentElement.clientHeight / 2}px;`;
      },
      /** マウンドの初期Y座標 */
      moundYPositionComputed() {
        return window.document.documentElement.clientHeight / 5;
      },
      /** ボールの初期Y座標 */
      ballYPositionComputed() {
        // 「マウンドの中心」にボールのtopが来るように調整
        return this.moundYPositionComputed + this.moundSize / 2;
      },
      /** バットの初期X座標 */
      batXPositionComputed() {
        return -this.batInitHeight * 1.2;
      },
      /** バットの初期Y座標 */
      batYPositionComputed() {
        return (
          window.document.documentElement.clientHeight -
          this.batInitHeight * 1.5
        );
      },
      /** 打つボタンの初期Y座標 */
      hitButtonYPositionComputed() {
        return this.batYPositionComputed + this.batInitHeight;
      },
      /** ボール半径 */
      ballRadiusComputed() {
        return this.ballSize / 2;
      },
      isBlankMessage() {
        return this.message === '';
      },
      /** ユーザの使用端末による盤の数 */
      boardItemCounterComputed() {
        const boardItemCounter = {
          iPhone: 2,
          iPad: 3,
          Android: 2,
          Mobile: 2,
          other: 4,
        };
        const userAgent = window.navigator.userAgent;
        return userAgent.indexOf('iPhone') > 0
          ? boardItemCounter.iPhone
          : userAgent.indexOf('iPad') > 0
          ? boardItemCounter.iPad
          : userAgent.indexOf('Android') > 0
          ? boardItemCounter.Android
          : userAgent.indexOf('Mobile') > 0
          ? boardItemCounter.Mobile
          : boardItemCounter.other;
      },
      isTwoStrikeComputed() {
        return this.strikeCount === 2;
      },
      /** ユーザ名表示メッセージ */
      userMessageComputed() {
        const userName =
          this.loginUserName === null
            ? `ゲスト${this.guestNumber}`
            : this.loginUserName;
        return `こんにちは ${userName} さん`;
      },
      /** ログインユーザでスタートボタンの表示テキスト */
      userStartButtonTextComputed() {
        return this.loginUserName === null
          ? 'ログインして開始'
          : `${this.loginUserName}として開始`;
      },
      // 画面側で使用しており、asyncとすると表示が上手くいかないため同期メソッドとしている
      isSelectingModeShownComputed() {
        return !(this.shouldShowInitImage || this.shouldShowResult);
      },
    },
    data: {
      guestNumber: null,
      guestUserId: null,
      rankings: {
        thisWeek: {
          titleText: '今週の得点ランキング',
          themeColor: 'primary',
          headerTexts: {},
          dataList: [],
        },
        history: {
          titleText: '歴代の得点ランキング',
          themeColor: 'success',
          headerTexts: {},
          dataList: [],
        },
      },
      headerTexts: {
        rankingText: '順位',
        playerText: 'プレイヤー',
        pointText: '得点',
        playDateText: 'プレイ日',
      },
      rankingThisWeekText: '今週の得点ランキング',
      rankingAllPeriodText: '歴代の得点ランキング',
      resultShowingButtonTexts: {
        saveResultText: '結果を上書き保存',
        retryText: '保存せずにリトライ',
        finishWithoutSaveText: '保存せずに終了',
      },
      guestButtonText: 'ゲストとして開始',
      changeAccountButtonText: 'アカウントを切り替えて開始',
      loginUserName: null,
      batSwingButtonText: '打つ',
      pointUnitText: '点',
      // 1バイト文字だと「S」「O」で大きさが異なるため2バイト文字としている
      strikeText: 'Ｓ : ',
      outText: 'Ｏ : ',
      message: '',
      resultMessage: '',
      boardItems: [],
      // width/height
      moundSize: 100,
      ballSize: 40,
      batInitWidth: 20,
      batInitHeight: 120,
      // transform
      xBallPosition: 0,
      yBallPosition: 0,
      batRotateDegree: 0,
      ratRotateDegreeSpeed: 10,
      maxBatRotateDegree: -100,
      // interval
      ballMovingInterval: 30,
      batSwingInterval: 10,
      reThrowInterval: 4000,
      messageShowingInterval: 1500,
      // speed
      minBallSpeed: 10,
      maxBallSpeed: 30,
      maxXBallPosition: 30,
      // count
      outCount: 0,
      point: 0,
      strikeCount: 0,
      // flag
      shouldShowInitImage: true,
      isGameOpened: false,
      shouldShowResult: false,
    },
    async mounted() {
      this.initializeTopMenuData();
      this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
      // 未ログイン時はゲストユーザを使用
      if (this.loginUserName === null) {
        await this.createGuestUser();
      }

      setTimeout(() => {
        this.shouldShowInitImage = false;
      }, this.messageShowingInterval);
      this.setBoardItems();
    },
    watch: {
      message() {
        // 1球ごとの試合中のメッセージは投球前に消す
        if (!this.isBlankMessage) {
          setTimeout(() => {
            this.message = '';
          }, this.messageShowingInterval);
        }
      },
    },
    methods: {
      /**
       * ゲストでスタートボタン押下処理
       */
      async onClickGuestStart() {
        await FirebaseAuthExtention.auth.signOutFromGoogle();
        this.loginUserName = null;
        if (this.guestUserId === null) {
          await this.createGuestUser();
        }

        this.executeBaseballGame();
      },
      /**
       * ログインしてスタートボタン押下処理
       */
      async onClickLogin() {
        // 未ログイン時のみfirebaseログイン処理
        if (!FirebaseAuthExtention.auth.isLoggedIn()) {
          try {
            await FirebaseAuthExtention.auth.signInWithPopupToGoogle();
          } catch {
            // ログインせずにログイン画面を閉じた際は処理終了
            return;
          }
        }

        // TODO:ゲストユーザでプレイしない場合は画面表示時に作成したゲストユーザを削除
        this.guestNumber = null;
        this.guestUserId = null;
        this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        this.executeBaseballGame();
      },
      /**
       * アカウントを切り替えてスタートボタン押下処理
       */
      async onClickChangeAccount() {
        try {
          await FirebaseAuthExtention.auth.signInWithPopupToGoogle();
        } catch {
          // ログインせずにログイン画面を閉じた際は処理終了
          return;
        }

        // TODO:ゲストユーザでプレイしない場合は画面表示時に作成したゲストユーザを削除
        this.guestNumber = null;
        this.guestUserId = null;
        this.loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        this.executeBaseballGame();
      },
      /**
       * トップ画面で削除ボタン押下処理
       * @param {*} recordItem
       */
      async onClickRecordDeleteButton(recordItem) {
        const shouldDelete = window.confirm(
          `記録を削除しますか。\n得点：${recordItem.point}\nプレイ日：${recordItem.playDate}`,
        );
        if (shouldDelete) {
          await FireStoreExtention.loginUserStore.deleteRanking(
            recordItem.playerId,
          );
          // ランキング再検索
          this.initializeTopMenuData();
        }
      },
      /**
       * 打つボタン押下処理
       */
      onClickHit() {
        // 徐々にバットを振る
        this.batRotateDegree = -this.ratRotateDegreeSpeed;
        const swingProcess = setInterval(() => {
          this.batRotateDegree -= this.ratRotateDegreeSpeed;
          if (this.batRotateDegree <= this.maxBatRotateDegree) {
            this.batRotateDegree = 0;
            clearInterval(swingProcess);
          }
        }, this.batSwingInterval);
      },
      /**
       * 「保存」ボタン押下処理
       */
      onClickSaveButton() {
        const isLoggedIn = FirebaseAuthExtention.auth.isLoggedIn();
        const loginUserId = FirebaseAuthExtention.auth.getLoginUserId();
        const loginUserName = FirebaseAuthExtention.auth.getLoginUserName();
        const loginUserIconImage =
          FirebaseAuthExtention.auth.getLoginUserIconImage();

        // 保存処理
        const parameter = {
          documentId: isLoggedIn ? loginUserId : this.guestUserId,
          userName: isLoggedIn ? loginUserName : `ゲスト${this.guestNumber}`,
          userIconImageUrl: isLoggedIn ? loginUserIconImage : guestImagePath,
          point: this.point,
        };
        if (isLoggedIn) {
          FireStoreExtention.loginUserStore.upsertRanking(parameter);
        } else {
          FireStoreExtention.guestStore.upsertRanking(parameter);
        }

        this.shouldShowResult = false;
        this.initializeTopMenuData();
      },
      /**
       * 「保存せずにリトライ」ボタン押下処理
       */
      onClickRetryButton() {
        this.shouldShowResult = false;
        this.executeBaseballGame();
      },
      /**
       * 結果表示画面で「保存せずに閉じる」ボタン押下処理
       */
      onClickFinishButton() {
        this.shouldShowResult = false;
        this.initializeTopMenuData();
      },

      /**
       * トップメニュー画面のデータセット
       */
      async initializeTopMenuData() {
        this.rankings.history.headerTexts = this.headerTexts;
        this.rankings.thisWeek.headerTexts = this.headerTexts;

        // 今週と歴代のランキングデータを取得
        // TODO:ランキング情報を取得中はモードセレクトしないように制御
        const rankingHistoryList = await FireStoreExtention.getRankingHistory();
        const rankingThisWeekList =
          await FireStoreExtention.getRankingThisWeek();
        this.rankings.history.dataList = await this.mapFirestoreToRankingTable(
          rankingHistoryList,
        );
        this.rankings.thisWeek.dataList = await this.mapFirestoreToRankingTable(
          rankingThisWeekList,
        );
      },
      /**
       * firestoreのデータを画面に表示するデータに変換
       * @param {*} firestoreDataList
       * @returns
       */
      async mapFirestoreToRankingTable(firestoreDataList) {
        const loginUser = await FirebaseAuthExtention.auth.getLoginUserId();
        return firestoreDataList.map((x) => {
          const rankingUserId = x[FireStoreColumn.userId];
          const lastPlayDate = x[FireStoreColumn.lastUpdated].toDate();
          return {
            playerIconImage: x[FireStoreColumn.userIconImageUrl],
            playerName: x[FireStoreColumn.userName],
            playerId: rankingUserId,
            point: x[FireStoreColumn.point],
            playDate: `${lastPlayDate.getFullYear()}/${
              lastPlayDate.getMonth() + 1
            }/${lastPlayDate.getDate()}`,
            isLoginUser: rankingUserId === loginUser,
          };
        });
      },
      /**
       * ゲストユーザの作成
       */
      async createGuestUser() {
        const { guestCountWithPadding, randomString } =
          await FireStoreExtention.guestStore.createUserId();
        this.guestNumber = Number(guestCountWithPadding);
        this.guestUserId = `${guestCountWithPadding}${randomString}`;
      },
      /**
       * ゲーム開始
       */
      executeBaseballGame() {
        // ゲーム開始前に初期化する
        this.clearBaseballGame();

        this.message = 'プレイボール！';
        this.isGameOpened = true;

        // 3アウトになるまで繰り返し投げ続ける
        const baseballGame = setInterval(async () => {
          // 1球投げる
          await this.throwBall();

          this.clearThrowingBall();

          if (this.outCount >= 3) {
            clearInterval(baseballGame);
            // ゲームセット後、一定時間はゲーム画面をそのまま表示する
            // 3アウト後にいきなり結果表示画面に移るとびっくりするため
            setTimeout(() => {
              this.resultMessage = getResultMessage(this.point);
              this.message = 'ゲームセット';
              setTimeout(() => {
                this.shouldShowResult = true;
                this.isGameOpened = false;
              }, this.messageShowingInterval);
            }, this.messageShowingInterval);
            return;
          }
        }, this.reThrowInterval);
      },
      /**
       * 盤のセット
       */
      setBoardItems() {
        this.boardItems = [];
        for (
          let countPointItem = 0;
          countPointItem < this.boardItemCounterComputed;
          countPointItem++
        ) {
          const targetIndex = Math.floor(Math.random() * boardItems.length);
          this.boardItems.push(boardItems[targetIndex]);
        }
      },
      /**
       * 投球クリア処理
       */
      clearThrowingBall() {
        this.yBallPosition = 0;
        this.xBallPosition = 0;
        this.setBoardItems();
      },
      /**
       * ゲームのクリア処理
       */
      clearBaseballGame() {
        this.point = 0;
        this.outCount = 0;
        this.strikeCount = 0;
      },
      /**
       * 投球
       */
      async throwBall() {
        const boardList = window.document.getElementsByClassName('point-item');

        let yBallIncrement = getRandomNumber(
          this.minBallSpeed,
          this.maxBallSpeed,
        );
        let xBallIncrement = 0;

        await new window.Promise((resolve) => {
          const ballMoveProcess = setInterval(() => {
            // ボールへの当たり判定
            // バットの始点座標、バットの終点座標
            const bat = window.document.getElementById('bat');
            const batPosition = bat.getBoundingClientRect();
            const batStartVec2 = new Vector2(batPosition.left, batPosition.top);
            const batEndVec2 = new Vector2(batPosition.right, batPosition.top);
            // ボールの中心座標
            const ball = window.document.getElementById('ball');
            const ballPosition = ball.getBoundingClientRect();
            const ballCenterVec2 = new Vector2(
              ballPosition.left + this.ballRadiusComputed,
              ballPosition.top + this.ballRadiusComputed,
            );
            // 判定処理
            // TODO:振り遅れの時どこまでバットに当たったといえるとするか（circleRaiusがマイナス）
            const isHitToBat = isHitCircleToLine(
              batStartVec2,
              batEndVec2,
              ballCenterVec2,
              this.ballRadiusComputed,
              -this.ballRadiusComputed * 3.5,
            );
            // 当たった時はボールを跳ね返す
            // 2度打ち防止のため、既にボールが跳ね返っているときはスルー
            if (isHitToBat && yBallIncrement >= 0) {
              yBallIncrement = -yBallIncrement;
              xBallIncrement = getRandomNumber(
                -this.maxXBallPosition,
                this.maxXBallPosition,
              );
              return;
            }

            // iOS系の端末でボールの座標を検知できない時があるため、座標がセットされていなければ打ち直しとする
            // TODO:どういうわけかバットとの当たり判定前にこのチェックを行うと検知できないエラーが発生するため、バットとの当たり判定後にチェックしている
            const shouldReThrow =
              ballPosition.x === 0 &&
              ballPosition.y === 0 &&
              ballPosition.bottom === 0 &&
              ballPosition.height === 0 &&
              ballPosition.left === 0 &&
              ballPosition.right === 0 &&
              ballPosition.top === 0 &&
              ballPosition.width === 0;
            if (shouldReThrow) {
              this.message = 'エラー発生。しばらくお待ちください。';
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // 盤への当たり判定
            for (const board of boardList) {
              const boardPosition = board.getBoundingClientRect();
              const boardBottom = boardPosition.bottom;
              // 盤下面とボールの当たり判定
              const boardBottomStartVec2 = new Vector2(
                boardPosition.left,
                boardBottom,
              );
              const boardBottomEndVec2 = new Vector2(
                boardPosition.right,
                boardBottom,
              );
              const isHitToBottomBoard = isHitCircleToLine(
                boardBottomStartVec2,
                boardBottomEndVec2,
                ballCenterVec2,
                this.ballRadiusComputed,
                0,
              );
              if (isHitToBottomBoard) {
                this.point += Number(board.dataset.point);
                const outNumber = Number(board.dataset.out);
                this.outCount =
                  this.outCount + outNumber >= 3
                    ? 3
                    : this.outCount + outNumber;
                this.strikeCount = 0;
                this.message = board.dataset.message;
                clearInterval(ballMoveProcess);
                resolve();
                return;
              }
            }

            // フェアゾーンに打ち返して盤に当たらなかったときはアウト
            if (ballPosition.top <= 0) {
              this.outCount += 1;
              this.strikeCount = 0;
              this.message = 'アウト';
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // 見逃し/空振り -> ストライク（アウトになり得る）
            const isHitToButton =
              ballPosition.bottom > this.hitButtonYPositionComputed;
            if (isHitToButton) {
              this.message = this.isTwoStrikeComputed ? '三振' : 'ストライク';
              this.outCount = this.isTwoStrikeComputed
                ? this.outCount + 1
                : this.outCount;
              this.strikeCount = this.isTwoStrikeComputed
                ? 0
                : this.strikeCount + 1;
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // ファール -> ストライク（アウトにはならない）
            const isFaul =
              ballPosition.left <= 0 ||
              ballPosition.right >= window.document.documentElement.clientWidth;
            if (isFaul) {
              this.strikeCount = this.isTwoStrikeComputed
                ? 2
                : this.strikeCount + 1;
              this.message = 'ファール';
              clearInterval(ballMoveProcess);
              resolve();
              return;
            }

            // ボール移動
            this.yBallPosition += yBallIncrement;
            // ボールが跳ね返っているときは左右にボールを振る
            if (yBallIncrement < 0) {
              this.xBallPosition += xBallIncrement;
            }
          }, this.ballMovingInterval);
        });
      },
    },
  });
};
