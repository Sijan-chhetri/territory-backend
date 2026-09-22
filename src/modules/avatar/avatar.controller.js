import prisma from "../../config/prisma.js";

// Adjust the prisma import path above depending on your project structure.

const AVATAR_TYPES = [
  "HEAD",
  "BODY",
  "HAIR",
  "EYE",
  "EYEBROW",
  "GLASSES",
  "TSHIRT",
  "PANTS",
  "SHOES",
];

const AVATAR_STATUSES = [
  "LOCKED",
  "FREE",
  "UNLOCKED",
];

/**
 * ============================================================
 * ADD AVATAR TO MASTER CATALOG
 * ============================================================
 *
 * POST /api/avatars
 *
 * body:
 * {
 *   "type": "HAIR",
 *   "file": "assets/avatar2/hair/menhair1.png",
 *   "status": "FREE"
 * }
 *
 * This does NOT add the avatar directly to a user.
 * It only adds it to the global avatar catalog.
 */
export const addAvatar = async (req, res) => {
  try {
    const {
      type,
      file,
      status = "FREE",
    } = req.body;

    if (!type || !file) {
      return res.status(400).json({
        success: false,
        message: "Avatar type and file are required.",
      });
    }

    const normalizedType = type.toUpperCase();
    const normalizedStatus = status.toUpperCase();

    if (!AVATAR_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid avatar type.",
        allowedTypes: AVATAR_TYPES,
      });
    }

    if (!AVATAR_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid avatar status.",
        allowedStatuses: AVATAR_STATUSES,
      });
    }

    const avatar = await prisma.avatar.upsert({
      where: {
        type_file: {
          type: normalizedType,
          file: file.trim(),
        },
      },

      update: {
        status: normalizedStatus,
      },

      create: {
        type: normalizedType,
        file: file.trim(),
        status: normalizedStatus,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Avatar added successfully.",
      avatar,
    });
  } catch (error) {
    console.error("ADD AVATAR ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add avatar.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};


/**
 * ============================================================
 * GET ALL AVATARS
 * ============================================================
 *
 * GET /api/avatars
 *
 * Shows:
 * - all avatar assets
 * - whether current user owns it
 * - whether current user has equipped it
 * - user's unlock status
 */
export const getAvatars = async (req, res) => {
  try {
    const userId = req.user.id;

    const avatars = await prisma.avatar.findMany({
      orderBy: [
        {
          type: "asc",
        },
        {
          createdAt: "asc",
        },
      ],

      include: {
        users: {
          where: {
            userId,
          },

          select: {
            id: true,
            status: true,
            isEquipped: true,
            unlockedAt: true,
          },
        },
      },
    });

    const formattedAvatars = avatars.map((avatar) => {
      const userAvatar = avatar.users[0] ?? null;

      return {
        id: avatar.id,
        type: avatar.type,
        file: avatar.file,

        // Global/master status
        status: avatar.status,

        owned: !!userAvatar,

        userStatus: userAvatar?.status ?? null,

        isEquipped:
          userAvatar?.isEquipped ?? false,

        unlockedAt:
          userAvatar?.unlockedAt ?? null,

        createdAt: avatar.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedAvatars.length,
      avatars: formattedAvatars,
    });
  } catch (error) {
    console.error("GET AVATARS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get avatars.",
    });
  }
};


/**
 * ============================================================
 * GET USER OWNED AVATARS
 * ============================================================
 *
 * GET /api/avatars/my
 *
 * Shows every avatar that has been added to UserAvatar.
 */
export const getMyAvatars = async (req, res) => {
  try {
    const userId = req.user.id;

    const userAvatars =
      await prisma.userAvatar.findMany({
        where: {
          userId,
        },

        include: {
          avatar: true,
        },

        orderBy: {
          createdAt: "asc",
        },
      });

    return res.status(200).json({
      success: true,
      count: userAvatars.length,
      avatars: userAvatars.map((item) => ({
        userAvatarId: item.id,

        avatarId: item.avatarId,

        type: item.avatar.type,

        file: item.avatar.file,

        avatarStatus: item.avatar.status,

        userStatus: item.status,

        isEquipped: item.isEquipped,

        unlockedAt: item.unlockedAt,
      })),
    });
  } catch (error) {
    console.error(
      "GET MY AVATARS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to get user's avatars.",
    });
  }
};


/**
 * ============================================================
 * SELECT / EQUIP AVATAR
 * ============================================================
 *
 * POST /api/avatars/:avatarId/select
 *
 * When user selects an avatar:
 *
 * 1. Find master avatar.
 * 2. Check whether it can be used.
 * 3. Add it to UserAvatar if it isn't already there.
 * 4. Unequip previous avatar of SAME TYPE.
 * 5. Equip selected avatar.
 *
 * This means:
 *
 * BODY     -> one equipped
 * HEAD     -> one equipped
 * HAIR     -> one equipped
 * EYE      -> one equipped
 * EYEBROW  -> one equipped
 * TSHIRT   -> one equipped
 * PANTS    -> one equipped
 * SHOES    -> one equipped
 * GLASSES  -> one equipped
 *
 * All of those can be equipped together.
 */
export const selectAvatar = async (
  req,
  res
) => {
  try {
    const userId = req.user.id;
    const { avatarId } = req.params;

    if (!avatarId) {
      return res.status(400).json({
        success: false,
        message: "Avatar ID is required.",
      });
    }

    const avatar =
      await prisma.avatar.findUnique({
        where: {
          id: avatarId,
        },
      });

    if (!avatar) {
      return res.status(404).json({
        success: false,
        message: "Avatar not found.",
      });
    }

    /*
     * Check whether user already owns
     * this particular avatar.
     */
    const existingUserAvatar =
      await prisma.userAvatar.findUnique({
        where: {
          userId_avatarId: {
            userId,
            avatarId,
          },
        },
      });

    /*
     * LOCKED master avatars cannot be
     * selected unless user has already
     * unlocked them.
     */
    if (
      avatar.status === "LOCKED" &&
      (!existingUserAvatar ||
        existingUserAvatar.status !==
          "UNLOCKED")
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This avatar is locked.",
      });
    }

    const result =
      await prisma.$transaction(
        async (tx) => {
          /*
           * Get every avatar belonging
           * to this same type.
           *
           * Example:
           *
           * selected = HAIR
           *
           * get all HAIR IDs
           */
          const sameTypeAvatars =
            await tx.avatar.findMany({
              where: {
                type: avatar.type,
              },

              select: {
                id: true,
              },
            });

          const sameTypeIds =
            sameTypeAvatars.map(
              (item) => item.id
            );

          /*
           * Unequip currently equipped
           * avatar of same type.
           */
          if (sameTypeIds.length > 0) {
            await tx.userAvatar.updateMany({
              where: {
                userId,

                avatarId: {
                  in: sameTypeIds,
                },

                isEquipped: true,
              },

              data: {
                isEquipped: false,
              },
            });
          }

          /*
           * Add to UserAvatar if this
           * user hasn't used/owned it
           * before.
           *
           * Otherwise simply equip it.
           */
          const selectedUserAvatar =
            await tx.userAvatar.upsert({
              where: {
                userId_avatarId: {
                  userId,
                  avatarId,
                },
              },

              update: {
                status: "UNLOCKED",
                isEquipped: true,

                unlockedAt:
                  existingUserAvatar
                    ?.unlockedAt ??
                  new Date(),
              },

              create: {
                userId,
                avatarId,

                status: "UNLOCKED",

                isEquipped: true,

                unlockedAt: new Date(),
              },

              include: {
                avatar: true,
              },
            });

          return selectedUserAvatar;
        }
      );

    return res.status(200).json({
      success: true,
      message: `${avatar.type} avatar equipped successfully.`,

      equippedAvatar: {
        userAvatarId: result.id,

        avatarId:
          result.avatar.id,

        type:
          result.avatar.type,

        file:
          result.avatar.file,

        status:
          result.status,

        isEquipped:
          result.isEquipped,
      },
    });
  } catch (error) {
    console.error(
      "SELECT AVATAR ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to select avatar.",
    });
  }
};


/**
 * ============================================================
 * GET CURRENT EQUIPPED AVATAR
 * ============================================================
 *
 * GET /api/avatars/equipped
 *
 * Returns every currently equipped
 * avatar component.
 */
export const getEquippedAvatars = async (
  req,
  res
) => {
  try {
    const userId = req.user.id;

    const equipped =
      await prisma.userAvatar.findMany({
        where: {
          userId,
          isEquipped: true,
          status: "UNLOCKED",
        },

        include: {
          avatar: true,
        },
      });

    /*
     * Useful for Flutter.
     *
     * Converts:
     *
     * [
     *   { type: HEAD },
     *   { type: BODY },
     *   { type: HAIR }
     * ]
     *
     * into:
     *
     * {
     *   HEAD: {...},
     *   BODY: {...},
     *   HAIR: {...}
     * }
     */
    const avatar = {};

    for (const item of equipped) {
      avatar[item.avatar.type] = {
        id: item.avatar.id,
        file: item.avatar.file,
        type: item.avatar.type,
      };
    }

    return res.status(200).json({
      success: true,

      avatar,

      equipped: equipped.map(
        (item) => ({
          userAvatarId: item.id,

          avatarId:
            item.avatar.id,

          type:
            item.avatar.type,

          file:
            item.avatar.file,

          isEquipped:
            item.isEquipped,
        })
      ),
    });
  } catch (error) {
    console.error(
      "GET EQUIPPED AVATAR ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to get equipped avatar.",
    });
  }
};


/**
 * ============================================================
 * UNEQUIP AVATAR TYPE
 * ============================================================
 *
 * POST /api/avatars/unequip/:type
 *
 * Mainly useful for things like:
 *
 * GLASSES -> None
 */
export const unequipAvatarType = async (
  req,
  res
) => {
  try {
    const userId = req.user.id;

    const type =
      req.params.type?.toUpperCase();

    if (!AVATAR_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid avatar type.",
      });
    }

    const avatars =
      await prisma.avatar.findMany({
        where: {
          type,
        },

        select: {
          id: true,
        },
      });

    const avatarIds = avatars.map(
      (avatar) => avatar.id
    );

    if (avatarIds.length > 0) {
      await prisma.userAvatar.updateMany({
        where: {
          userId,

          avatarId: {
            in: avatarIds,
          },
        },

        data: {
          isEquipped: false,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message:
        `${type} unequipped successfully.`,
    });
  } catch (error) {
    console.error(
      "UNEQUIP AVATAR ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to unequip avatar.",
    });
  }
};

/**
 * ============================================================
 * ADD MULTIPLE AVATARS TO MASTER CATALOG
 * ============================================================
 *
 * POST /api/avatars/bulk
 *
 * Body:
 * {
 *   "avatars": [
 *     {
 *       "type": "HAIR",
 *       "file": "assets/avatar2/hair/menhair1.png",
 *       "status": "FREE"
 *     },
 *     {
 *       "type": "HAIR",
 *       "file": "assets/avatar2/hair/menhair2.png",
 *       "status": "FREE"
 *     }
 *   ]
 * }
 */

export const addMultipleAvatars = async (req, res) => {
  try {
    const { avatars } = req.body;

    if (!Array.isArray(avatars) || avatars.length === 0) {
      return res.status(400).json({
        success: false,
        message: "avatars must be a non-empty array.",
      });
    }

    const allowedTypes = [
      "HEAD",
      "BODY",
      "HAIR",
      "EYE",
      "EYEBROW",
      "GLASSES",
      "TSHIRT",
      "PANTS",
      "SHOES",
    ];

    const allowedStatuses = [
      "LOCKED",
      "FREE",
      "UNLOCKED",
    ];

    const preparedAvatars = [];

    for (let i = 0; i < avatars.length; i++) {
      const avatar = avatars[i];

      if (!avatar.type || !avatar.file) {
        return res.status(400).json({
          success: false,
          message: `Avatar at index ${i} requires type and file.`,
        });
      }

      const type = avatar.type.toUpperCase();

      const status = (
        avatar.status || "FREE"
      ).toUpperCase();

      if (!allowedTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid avatar type at index ${i}: ${avatar.type}`,
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status at index ${i}: ${avatar.status}`,
        });
      }

      preparedAvatars.push({
        type,
        file: avatar.file.trim(),
        status,
      });
    }

    /*
     * createMany is efficient for inserting many rows.
     *
     * skipDuplicates works because your schema has:
     *
     * @@unique([type, file])
     */
    const result = await prisma.avatar.createMany({
      data: preparedAvatars,
      skipDuplicates: true,
    });

    /*
     * Get the avatars back so the API can return them.
     */
    const insertedAvatars = await prisma.avatar.findMany({
      where: {
        OR: preparedAvatars.map((avatar) => ({
          type: avatar.type,
          file: avatar.file,
        })),
      },

      orderBy: [
        {
          type: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
    });

    return res.status(201).json({
      success: true,
      message: "Avatars added successfully.",

      received: avatars.length,

      inserted: result.count,

      avatars: insertedAvatars,
    });
  } catch (error) {
    console.error("ADD MULTIPLE AVATARS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add avatars.",

      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};





export const equipMultipleAvatars = async (req, res) => {
  try {
    const userId = req.user.id;
    const { avatarIds } = req.body;

    // =====================================================
    // VALIDATION
    // =====================================================

    if (!Array.isArray(avatarIds) || avatarIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "avatarIds must be a non-empty array.",
      });
    }

    // Remove duplicate IDs
    const uniqueAvatarIds = [...new Set(avatarIds)];

    // =====================================================
    // GET ALL REQUESTED AVATARS
    // =====================================================

    const avatars = await prisma.avatar.findMany({
      where: {
        id: {
          in: uniqueAvatarIds,
        },
      },
    });

    // Make sure every supplied ID actually exists
    if (avatars.length !== uniqueAvatarIds.length) {
      const foundIds = new Set(
        avatars.map((avatar) => avatar.id)
      );

      const invalidIds = uniqueAvatarIds.filter(
        (id) => !foundIds.has(id)
      );

      return res.status(404).json({
        success: false,
        message: "One or more avatars were not found.",
        invalidAvatarIds: invalidIds,
      });
    }

    // =====================================================
    // MAKE SURE ONLY ONE AVATAR PER TYPE IS SENT
    // =====================================================

    const typeMap = new Map();

    for (const avatar of avatars) {
      if (typeMap.has(avatar.type)) {
        return res.status(400).json({
          success: false,
          message: `You can only equip one ${avatar.type} avatar at a time.`,
        });
      }

      typeMap.set(avatar.type, avatar);
    }

    // =====================================================
    // GET USER'S EXISTING AVATAR RECORDS
    // =====================================================

    const existingUserAvatars =
      await prisma.userAvatar.findMany({
        where: {
          userId,
          avatarId: {
            in: uniqueAvatarIds,
          },
        },
      });

    const existingMap = new Map(
      existingUserAvatars.map((item) => [
        item.avatarId,
        item,
      ])
    );

    // =====================================================
    // CHECK LOCKED AVATARS
    // =====================================================

    for (const avatar of avatars) {
      const userAvatar = existingMap.get(avatar.id);

      /*
       * FREE:
       * User may use it immediately.
       *
       * LOCKED:
       * User must already have it UNLOCKED
       * in UserAvatar.
       */
      if (
        avatar.status === "LOCKED" &&
        (!userAvatar ||
          userAvatar.status !== "UNLOCKED")
      ) {
        return res.status(403).json({
          success: false,
          message: `${avatar.type} avatar is locked.`,
          avatar: {
            id: avatar.id,
            type: avatar.type,
            file: avatar.file,
          },
        });
      }
    }

    // Types being changed by this request
    const selectedTypes = avatars.map(
      (avatar) => avatar.type
    );

    // =====================================================
    // TRANSACTION
    // =====================================================

    const result = await prisma.$transaction(
      async (tx) => {
        /*
         * Find ALL master avatars belonging to the types
         * being updated.
         *
         * For example if request contains:
         *
         * HAIR
         * HEAD
         * TSHIRT
         *
         * we find every HAIR, HEAD and TSHIRT avatar.
         */
        const avatarsOfSelectedTypes =
          await tx.avatar.findMany({
            where: {
              type: {
                in: selectedTypes,
              },
            },

            select: {
              id: true,
            },
          });

        const sameTypeAvatarIds =
          avatarsOfSelectedTypes.map(
            (avatar) => avatar.id
          );

        // =================================================
        // UNEQUIP OLD AVATARS OF THOSE TYPES
        // =================================================

        await tx.userAvatar.updateMany({
          where: {
            userId,

            avatarId: {
              in: sameTypeAvatarIds,
            },

            isEquipped: true,
          },

          data: {
            isEquipped: false,
          },
        });

        // =================================================
        // EQUIP EACH SELECTED AVATAR
        // =================================================

        const selected = [];

        for (const avatar of avatars) {
          const existing =
            existingMap.get(avatar.id);

          const userAvatar =
            await tx.userAvatar.upsert({
              where: {
                userId_avatarId: {
                  userId,
                  avatarId: avatar.id,
                },
              },

              update: {
                isEquipped: true,

                // If user already owned/unlocked it,
                // keep it unlocked.
                status: "UNLOCKED",

                unlockedAt:
                  existing?.unlockedAt ??
                  new Date(),
              },

              create: {
                userId,
                avatarId: avatar.id,

                status: "UNLOCKED",

                isEquipped: true,

                unlockedAt: new Date(),
              },

              include: {
                avatar: true,
              },
            });

          selected.push(userAvatar);
        }

        // =================================================
        // RETURN COMPLETE CURRENT AVATAR
        // =================================================

        const currentlyEquipped =
          await tx.userAvatar.findMany({
            where: {
              userId,
              isEquipped: true,
            },

            include: {
              avatar: true,
            },
          });

        return {
          selected,
          currentlyEquipped,
        };
      }
    );

    // =====================================================
    // FORMAT CURRENT AVATAR FOR FLUTTER
    // =====================================================

    const equippedAvatar = {};

    for (const item of result.currentlyEquipped) {
      equippedAvatar[item.avatar.type] = {
        id: item.avatar.id,
        type: item.avatar.type,
        file: item.avatar.file,
        status: item.status,
        isEquipped: item.isEquipped,
      };
    }

    return res.status(200).json({
      success: true,
      message: "Avatar equipped successfully.",

      equippedCount:
        result.currentlyEquipped.length,

      avatar: equippedAvatar,

      equipped: result.currentlyEquipped.map(
        (item) => ({
          userAvatarId: item.id,
          avatarId: item.avatar.id,
          type: item.avatar.type,
          file: item.avatar.file,
          status: item.status,
          isEquipped: item.isEquipped,
        })
      ),
    });
  } catch (error) {
    console.error(
      "EQUIP MULTIPLE AVATARS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to equip avatars.",

      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};